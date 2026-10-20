// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

// Single object tracker for videos from moving cameras (e.g. drones), useful for small objects.
// Every frame:
// 1. the camera motion is estimated from the background (optical flow + RANSAC affine model)
//    and applied to the target state, as in BoT-SORT
// 2. the target position is predicted with the Kalman filter of ByteTrack
//    (state: center x, center y, aspect ratio, height and their velocities)
// 3. the target is searched near the prediction by template matching; candidates that do not
//    agree with the motion model are rejected by the Mahalanobis distance (ByteTrack/DeepSORT gating)
// 4. a confident match updates the filter, a weak one updates it with a larger measurement noise,
//    without a match the filter only predicts (the target is occluded); after many misses the target is lost
// The box keeps the size and the margins of the box drawn by the user: its size only follows the camera
// zoom, and the template is refreshed only with patches very similar to the initial appearance, so that
// the box neither shrinks to the darkest (or brightest) part of the object nor slides off it.

import { clamp } from './math-utils';
import type { TrackerMILInterface } from './tracker-mil';

interface TrackingResult {
    updated: boolean;
    points: number[];
}

type Matrix = number[][];

function zeros(rows: number, cols: number): Matrix {
    return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

function identity(size: number): Matrix {
    const result = zeros(size, size);
    for (let i = 0; i < size; i++) result[i][i] = 1;
    return result;
}

function multiply(a: Matrix, b: Matrix): Matrix {
    const result = zeros(a.length, b[0].length);
    for (let i = 0; i < a.length; i++) {
        for (let k = 0; k < b.length; k++) {
            const aik = a[i][k];
            if (aik !== 0) {
                for (let j = 0; j < b[0].length; j++) result[i][j] += aik * b[k][j];
            }
        }
    }
    return result;
}

function transpose(a: Matrix): Matrix {
    return a[0].map((_, j) => a.map((row) => row[j]));
}

function multiplyVector(a: Matrix, v: number[]): number[] {
    return a.map((row) => row.reduce((acc, value, j) => acc + value * v[j], 0));
}

function invert(a: Matrix): Matrix {
    // Gauss-Jordan elimination with partial pivoting, the matrices are small (4x4, 2x2)
    const n = a.length;
    const m = a.map((row, i) => [...row, ...identity(n)[i]]);
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
        }
        [m[col], m[pivot]] = [m[pivot], m[col]];
        const divisor = m[col][col] || 1e-12;
        for (let j = 0; j < 2 * n; j++) m[col][j] /= divisor;
        for (let row = 0; row < n; row++) {
            if (row !== col) {
                const factor = m[row][col];
                for (let j = 0; j < 2 * n; j++) m[row][j] -= factor * m[col][j];
            }
        }
    }
    return m.map((row) => row.slice(n));
}

// Kalman filter of ByteTrack (yolox/tracker/kalman_filter.py): constant velocity model in the
// (x, y, a, h) space, the noise is proportional to the object height
export class KalmanFilterXYAH {
    static readonly STD_POSITION = 1 / 20;
    static readonly STD_VELOCITY = 1 / 160;

    public mean: number[];
    public covariance: Matrix;
    readonly #motion: Matrix;
    readonly #update: Matrix;

    constructor(measurement: number[]) {
        this.#motion = identity(8);
        for (let i = 0; i < 4; i++) this.#motion[i][i + 4] = 1;
        this.#update = identity(8).slice(0, 4);

        const h = measurement[3];
        const { STD_POSITION: p, STD_VELOCITY: v } = KalmanFilterXYAH;
        this.mean = [...measurement, 0, 0, 0, 0];
        const std = [2 * p * h, 2 * p * h, 1e-2, 2 * p * h, 10 * v * h, 10 * v * h, 1e-5, 10 * v * h];
        this.covariance = zeros(8, 8);
        std.forEach((value, i) => { this.covariance[i][i] = value * value; });
    }

    predict(): void {
        const h = this.mean[3];
        const { STD_POSITION: p, STD_VELOCITY: v } = KalmanFilterXYAH;
        const std = [p * h, p * h, 1e-2, p * h, v * h, v * h, 1e-5, v * h];
        this.mean = multiplyVector(this.#motion, this.mean);
        this.covariance = multiply(multiply(this.#motion, this.covariance), transpose(this.#motion));
        std.forEach((value, i) => { this.covariance[i][i] += value * value; });
    }

    // applies camera motion given as a 2x3 affine matrix (global motion compensation of BoT-SORT)
    applyCameraMotion(affine: number[], extraPositionStd: number): void {
        const [a, b, tx, c, d, ty] = affine;
        const scale = Math.sqrt(Math.abs(a * d - b * c));
        const transform = identity(8);
        transform[0][0] = a; transform[0][1] = b; transform[1][0] = c; transform[1][1] = d;
        transform[4][4] = a; transform[4][5] = b; transform[5][4] = c; transform[5][5] = d;
        transform[3][3] = scale;
        transform[7][7] = scale;
        this.mean = multiplyVector(transform, this.mean);
        this.mean[0] += tx;
        this.mean[1] += ty;
        this.covariance = multiply(multiply(transform, this.covariance), transpose(transform));
        this.covariance[0][0] += extraPositionStd ** 2;
        this.covariance[1][1] += extraPositionStd ** 2;
    }

    // covariance of the expected position measurement
    positionInnovation(): Matrix {
        const std = KalmanFilterXYAH.STD_POSITION * this.mean[3];
        return [
            [this.covariance[0][0] + std * std, this.covariance[0][1]],
            [this.covariance[1][0], this.covariance[1][1] + std * std],
        ];
    }

    // size changes are explained by the camera motion and by measurements,
    // a learned size velocity would keep changing the box when measurements stop
    dampSizeVelocity(factor: number): void {
        this.mean[6] *= factor;
        this.mean[7] *= factor;
    }

    update(measurement: number[], noiseScale: number | number[] = 1): void {
        const h = this.mean[3];
        const p = KalmanFilterXYAH.STD_POSITION;
        const scales = Array.isArray(noiseScale) ? noiseScale : [noiseScale, noiseScale, noiseScale, noiseScale];
        const std = [p * h, p * h, 1e-1, p * h].map((value, i) => value * scales[i]);
        const H = this.#update;
        const projected = multiply(multiply(H, this.covariance), transpose(H));
        std.forEach((value, i) => { projected[i][i] += value * value; });
        const gain = multiply(multiply(this.covariance, transpose(H)), invert(projected));
        const predicted = multiplyVector(H, this.mean);
        const innovation = measurement.map((value, i) => value - predicted[i]);
        const correction = multiplyVector(gain, innovation);
        this.mean = this.mean.map((value, i) => value + correction[i]);
        const gainH = multiply(gain, H);
        this.covariance = multiply(
            identity(8).map((row, i) => row.map((value, j) => value - gainH[i][j])),
            this.covariance,
        );
    }

    box(): number[] {
        const [x, y, a, h] = this.mean;
        const w = a * h;
        return [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
    }
}

export default class TrackerKalmanImplementation implements TrackerMILInterface {
    // matching scores (normalized cross-correlation)
    static readonly HIGH_SCORE = 0.6;
    static readonly LOW_SCORE = 0.3;
    // the template is refreshed only with patches very similar to the initial appearance:
    // a loose check lets a slightly misplaced box teach the template the wrong position
    static readonly TEMPLATE_UPDATE_RATE = 0.1;
    static readonly ANCHOR_SIMILARITY = 0.8;
    // squared Mahalanobis distance: candidates further from the prediction are ignored
    static readonly GATE = 16;
    static readonly DISTANCE_WEIGHT = 0.02;
    static readonly CAMERA_STD = 1;
    // frames without a match: the predicted box is still returned for a while, then the target is lost
    static readonly MAX_COASTING = 10;
    static readonly MAX_LOST = 30;
    // camera motion is estimated on images reduced to this width
    static readonly MOTION_IMAGE_WIDTH = 960;
    static readonly SIZE_VELOCITY_DECAY = 0.5;

    public name: string;
    private cv: any;
    private initialImage: ImageData | null;
    private previousGray: any;
    private template: any; // CV_32F
    private anchor: any; // CV_32F, the initial appearance
    private kalman: KalmanFilterXYAH | null;
    private lost: number;

    constructor(cv: any) {
        this.cv = cv;
        this.name = 'TrackerKalman';
        this.initialImage = null;
        this.previousGray = null;
        this.template = null;
        this.anchor = null;
        this.kalman = null;
        this.lost = 0;
    }

    private toGray(src: ImageData): any {
        const { cv } = this;
        const rgba = cv.matFromImageData(src);
        const gray = new cv.Mat();
        cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
        rgba.delete();
        return gray;
    }

    private crop(gray: any, x: number, y: number, width: number, height: number): any {
        const { cv } = this;
        const roi = gray.roi(new cv.Rect(x, y, width, height));
        const result = new cv.Mat();
        roi.convertTo(result, cv.CV_32F);
        roi.delete();
        return result;
    }

    private resized(mat: any, width: number, height: number): any {
        const { cv } = this;
        const result = new cv.Mat();
        cv.resize(mat, result, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR);
        return result;
    }

    private matchScore(image: any, template: any): number {
        const { cv } = this;
        const result = new cv.Mat();
        cv.matchTemplate(image, template, result, cv.TM_CCOEFF_NORMED);
        const score = result.data32F[0];
        result.delete();
        return score;
    }

    // affine motion of the background between two frames: [a, b, tx, c, d, ty]
    private estimateCameraMotion(previous: any, current: any, targetBox: number[]): number[] {
        const { cv } = this;
        const noMotion = [1, 0, 0, 0, 1, 0];
        const scale = Math.min(1, TrackerKalmanImplementation.MOTION_IMAGE_WIDTH / previous.cols);
        const objects: any[] = [];
        const keep = <T>(object: T): T => { objects.push(object); return object; };

        try {
            let prev = previous;
            let cur = current;
            if (scale < 1) {
                const size = new cv.Size(Math.round(previous.cols * scale), Math.round(previous.rows * scale));
                prev = keep(new cv.Mat());
                cur = keep(new cv.Mat());
                cv.resize(previous, prev, size, 0, 0, cv.INTER_AREA);
                cv.resize(current, cur, size, 0, 0, cv.INTER_AREA);
            }

            // features of the target itself do not describe the camera motion
            const mask = keep(new cv.Mat(prev.rows, prev.cols, cv.CV_8UC1, new cv.Scalar(255)));
            const [x1, y1, x2, y2] = targetBox.map((value) => Math.round(value * scale));
            const mx1 = clamp(x1, 0, prev.cols);
            const my1 = clamp(y1, 0, prev.rows);
            const mx2 = clamp(x2, 0, prev.cols);
            const my2 = clamp(y2, 0, prev.rows);
            if (mx2 > mx1 && my2 > my1) {
                cv.rectangle(mask, new cv.Point(mx1, my1), new cv.Point(mx2, my2), new cv.Scalar(0), -1);
            }

            const points = keep(new cv.Mat());
            cv.goodFeaturesToTrack(prev, points, 400, 0.01, 8, mask, 3, false, 0.04);
            if (points.rows < 10) {
                return noMotion;
            }

            const nextPoints = keep(new cv.Mat());
            const status = keep(new cv.Mat());
            const error = keep(new cv.Mat());
            const criteria = new cv.TermCriteria(cv.TermCriteria_EPS + cv.TermCriteria_COUNT, 30, 0.01);
            cv.calcOpticalFlowPyrLK(prev, cur, points, nextPoints, status, error, new cv.Size(21, 21), 3, criteria);

            const from: number[] = [];
            const to: number[] = [];
            for (let i = 0; i < status.rows; i++) {
                if (status.data[i] === 1) {
                    from.push(points.data32F[i * 2], points.data32F[i * 2 + 1]);
                    to.push(nextPoints.data32F[i * 2], nextPoints.data32F[i * 2 + 1]);
                }
            }
            if (from.length < 20) {
                return noMotion;
            }

            const fromMat = keep(cv.matFromArray(from.length / 2, 1, cv.CV_32FC2, from));
            const toMat = keep(cv.matFromArray(to.length / 2, 1, cv.CV_32FC2, to));
            const inliers = keep(new cv.Mat());
            const affine = keep(cv.estimateAffine2D(fromMat, toMat, inliers, cv.RANSAC, 2, 2000, 0.99, 10));
            if (affine.empty()) {
                return noMotion;
            }

            const m = affine.data64F;
            // back to the coordinates of the full size image
            return [m[0], m[1], m[2] / scale, m[3], m[4], m[5] / scale];
        } catch (_error) {
            return noMotion;
        } finally {
            objects.forEach((object) => object.delete());
        }
    }

    public init(src: ImageData, points: number[]): void {
        if (points.length !== 4) {
            throw Error(`TrackerKalman must be initialized with rectangle, but got ${points.length % 2} points.`);
        }

        this.delete();
        const gray = this.toGray(src);
        const x1 = Math.round(clamp(points[0], 0, src.width));
        const y1 = Math.round(clamp(points[1], 0, src.height));
        const x2 = Math.round(clamp(points[2], 0, src.width));
        const y2 = Math.round(clamp(points[3], 0, src.height));
        if (x2 - x1 < 2 || y2 - y1 < 2) {
            gray.delete();
            throw Error('TrackerKalman got rectangle out of image bounds');
        }

        // the drawn box is kept as is: its margins around the object are what the user wants to get
        this.initialImage = src;
        this.previousGray = gray;
        this.template = this.crop(gray, x1, y1, x2 - x1, y2 - y1);
        this.anchor = this.template.clone();
        const [w, h] = [x2 - x1, y2 - y1];
        this.kalman = new KalmanFilterXYAH([x1 + w / 2, y1 + h / 2, w / h, h]);
        this.lost = 0;
    }

    public reinit(points: number[]): void {
        if (!this.initialImage) {
            throw Error('TrackerKalman needs to be initialized before re-initialization');
        }

        this.init(this.initialImage, points);
    }

    public update(src: ImageData): TrackingResult {
        if (!this.kalman || !this.previousGray) {
            throw Error('TrackerKalman needs to be initialized before updating');
        }

        if (src.width !== this.previousGray.cols || src.height !== this.previousGray.rows) {
            throw new Error(
                `Images have different resolution (previous is ${this.previousGray.cols}x${this.previousGray.rows}, ` +
                `current one is ${src.width}x${src.height})`,
            );
        }

        if (this.lost > TrackerKalmanImplementation.MAX_LOST) {
            return { updated: false, points: this.kalman.box() };
        }

        const { cv } = this;
        const T = TrackerKalmanImplementation;
        const gray = this.toGray(src);
        const camera = this.estimateCameraMotion(this.previousGray, gray, this.kalman.box());
        this.previousGray.delete();
        this.previousGray = gray;

        this.kalman.dampSizeVelocity(T.SIZE_VELOCITY_DECAY);
        this.kalman.predict();
        this.kalman.applyCameraMotion(camera, T.CAMERA_STD);

        const [x, y, aspect, height] = this.kalman.mean;
        if (x < 0 || y < 0 || x >= gray.cols || y >= gray.rows) {
            // the object has left the image
            this.lost = T.MAX_LOST + 1;
            return { updated: false, points: this.kalman.box() };
        }
        const th = Math.max(4, Math.round(height));
        const tw = Math.max(4, Math.round(aspect * height));
        const rx = Math.max(2 * tw, 24);
        const ry = Math.max(2 * th, 24);
        const wx1 = clamp(Math.round(x - tw / 2 - rx), 0, gray.cols);
        const wy1 = clamp(Math.round(y - th / 2 - ry), 0, gray.rows);
        const wx2 = clamp(Math.round(x + tw / 2 + rx), 0, gray.cols);
        const wy2 = clamp(Math.round(y + th / 2 + ry), 0, gray.rows);

        let matched = false;
        if (wx2 - wx1 > tw && wy2 - wy1 > th) {
            const objects: any[] = [];
            const keep = <O>(object: O): O => { objects.push(object); return object; };
            try {
                const window = keep(this.crop(gray, wx1, wy1, wx2 - wx1, wy2 - wy1));
                const template = keep(this.resized(this.template, tw, th));
                const response = keep(new cv.Mat());
                cv.matchTemplate(window, template, response, cv.TM_CCOEFF_NORMED);

                // the best candidate allowed by the motion model
                const innovation = invert(this.kalman.positionInnovation());
                let best = -Infinity;
                let bestScore = 0;
                let bestX = 0;
                let bestY = 0;
                for (let row = 0; row < response.rows; row++) {
                    const dy = wy1 + row + th / 2 - y;
                    for (let col = 0; col < response.cols; col++) {
                        const dx = wx1 + col + tw / 2 - x;
                        const distance = innovation[0][0] * dx * dx + 2 * innovation[0][1] * dx * dy +
                            innovation[1][1] * dy * dy;
                        if (distance <= T.GATE) {
                            const score = response.data32F[row * response.cols + col];
                            const weighted = score - T.DISTANCE_WEIGHT * distance;
                            if (weighted > best) {
                                best = weighted;
                                bestScore = score;
                                bestX = col;
                                bestY = row;
                            }
                        }
                    }
                }

                if (best > -Infinity && bestScore >= T.LOW_SCORE) {
                    matched = true;
                    const centerX = wx1 + bestX + tw / 2;
                    const centerY = wy1 + bestY + th / 2;
                    // weak matches are used too (as low score detections in ByteTrack), but trusted less
                    const noise = bestScore >= T.HIGH_SCORE ? 1 : 4;
                    this.kalman.update([centerX, centerY, aspect, height], noise);

                    if (bestScore >= T.HIGH_SCORE) {
                        // the template follows the filtered box
                        const [px1, py1, px2, py2] = this.kalman.box();
                        const pw = Math.max(4, Math.round(px2 - px1));
                        const ph = Math.max(4, Math.round(py2 - py1));
                        const left = Math.round((px1 + px2) / 2 - pw / 2);
                        const top = Math.round((py1 + py2) / 2 - ph / 2);
                        if (left >= 0 && top >= 0 && left + pw <= gray.cols && top + ph <= gray.rows) {
                            const patch = keep(this.crop(gray, left, top, pw, ph));
                            const anchor = keep(this.resized(this.anchor, pw, ph));
                            if (this.matchScore(patch, anchor) >= T.ANCHOR_SIMILARITY) {
                                const current = keep(this.resized(this.template, pw, ph));
                                const blended = keep(new cv.Mat());
                                cv.addWeighted(
                                    current, 1 - T.TEMPLATE_UPDATE_RATE, patch, T.TEMPLATE_UPDATE_RATE, 0, blended,
                                );
                                const updated = this.resized(blended, this.anchor.cols, this.anchor.rows);
                                this.template.delete();
                                this.template = updated;
                            }
                        }
                    }
                }
            } finally {
                objects.forEach((object) => object.delete());
            }
        }

        this.lost = matched ? 0 : this.lost + 1;
        return {
            updated: this.lost <= T.MAX_COASTING,
            points: this.kalman.box(),
        };
    }

    public delete(): void {
        for (const mat of [this.previousGray, this.template, this.anchor]) {
            if (mat) mat.delete();
        }
        this.previousGray = null;
        this.template = null;
        this.anchor = null;
    }
}
