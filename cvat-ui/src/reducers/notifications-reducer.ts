// Copyright (C) 2020-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import { AnyAction } from 'redux';

import { ServerError, RequestError, StorageLocation } from 'cvat-core-wrapper';
import { AuthActionTypes } from 'actions/auth-actions';
import { FormatsActionTypes } from 'actions/formats-actions';
import { ModelsActionTypes } from 'actions/models-actions';
import { TasksActionTypes } from 'actions/tasks-actions';
import { ProjectsActionTypes } from 'actions/projects-actions';
import { AboutActionTypes } from 'actions/about-actions';
import { AnnotationActionTypes } from 'actions/annotation-actions';
import { NotificationsActionType } from 'actions/notification-actions';
import { BoundariesActionTypes } from 'actions/boundaries-actions';
import { UserAgreementsActionTypes } from 'actions/useragreements-actions';
import { ReviewActionTypes } from 'actions/review-actions';
import { CloudStorageActionTypes } from 'actions/cloud-storage-actions';
import { OrganizationActionsTypes } from 'actions/organization-actions';
import { JobsActionTypes } from 'actions/jobs-actions';
import { WebhooksActionsTypes } from 'actions/webhooks-actions';
import { InvitationsActionTypes } from 'actions/invitations-actions';
import { ServerAPIActionTypes } from 'actions/server-actions';
import { RequestsActionsTypes } from 'actions/requests-actions';
import { ImportActionTypes } from 'actions/import-actions';
import { ExportActionTypes } from 'actions/export-actions';
import { ConsensusActionTypes } from 'actions/consensus-actions';
import { BulkActionsTypes } from 'actions/bulk-actions';
import { getInstanceType } from 'actions/common';
import { ResourceUpdateTypes } from 'utils/enums';

import config from 'config';
import { NotificationsState } from '.';
import { t } from 'cvat-i18n';

const shouldLog = (error: Error): boolean => {
    if (error instanceof ServerError) {
        const ignoredCodes = [
            // 0, Network Error: may not to be logged on server. Log it here.
            400, // client error: not interested
            401, // client error: not interested
            403, // client error: not interested
            404, // client error: not interested
            429, // client error: not interested
            500, // usually logged by server
            // 502, Bad Gateway: may not to be logged on server. Log it here.
            // 503, Service Unavailable: may not to be logged on server. Log it here.
            // 504, Gateway Timeout: may not to be logged on server. Log it here.
        ];
        return !ignoredCodes.includes(error.code);
    }

    return !(error instanceof RequestError);
};

const defaultState: NotificationsState = {
    errors: {
        auth: {
            authenticated: null,
            login: null,
            logout: null,
            register: null,
            changePassword: null,
            requestPasswordReset: null,
            resetPassword: null,
            updateUser: null,
            getApiTokens: null,
            createApiToken: null,
            updateApiToken: null,
            revokeApiToken: null,
        },
        serverAPI: {
            fetching: null,
        },
        projects: {
            fetching: null,
            updating: null,
            deleting: null,
            creating: null,
            restoring: null,
            backuping: null,
        },
        tasks: {
            fetching: null,
            updating: null,
            dumping: null,
            loading: null,
            exportingAsDataset: null,
            deleting: null,
            creating: null,
            exporting: null,
            importing: null,
            moving: null,
            mergingConsensus: null,
        },
        jobs: {
            updating: null,
            fetching: null,
            creating: null,
            deleting: null,
        },
        formats: {
            fetching: null,
        },
        users: {
            fetching: null,
        },
        about: {
            fetching: null,
        },
        models: {
            starting: null,
            fetching: null,
            canceling: null,
            metaFetching: null,
            inferenceStatusFetching: null,
            creating: null,
            deleting: null,
        },
        annotation: {
            saving: null,
            jobFetching: null,
            jobUpdating: null,
            frameFetching: null,
            changingLabelColor: null,
            updating: null,
            creating: null,
            merging: null,
            grouping: null,
            joining: null,
            slicing: null,
            splitting: null,
            removing: null,
            propagating: null,
            collectingStatistics: null,
            savingJob: null,
            uploadAnnotations: null,
            removeAnnotations: null,
            fetchingAnnotations: null,
            undo: null,
            redo: null,
            search: null,
            deleteFrame: null,
            restoreFrame: null,
            savingLogs: null,
            canvas: null,
        },
        boundaries: {
            resetError: null,
        },
        userAgreements: {
            fetching: null,
        },
        review: {
            commentingIssue: null,
            finishingIssue: null,
            reopeningIssue: null,
            resolvingIssue: null,
            submittingReview: null,
            deletingIssue: null,
        },
        exporting: {
            dataset: null,
            annotation: null,
            backup: null,
        },
        importing: {
            dataset: null,
            annotation: null,
            backup: null,
        },
        cloudStorages: {
            creating: null,
            fetching: null,
            updating: null,
            deleting: null,
        },
        organizations: {
            fetching: null,
            creating: null,
            updating: null,
            activation: null,
            deleting: null,
            leaving: null,
            inviting: null,
            updatingMembership: null,
            removingMembership: null,
            deletingInvitation: null,
        },
        webhooks: {
            fetching: null,
            creating: null,
            updating: null,
            deleting: null,
        },
        analytics: {
            fetching: null,
            fetchingSettings: null,
            updatingSettings: null,
        },
        invitations: {
            fetching: null,
            acceptingInvitation: null,
            decliningInvitation: null,
            resendingInvitation: null,
        },
        requests: {
            fetching: null,
            canceling: null,
            deleting: null,
        },
        bulkOperation: {
            processing: null,
        },
    },
    messages: {
        tasks: {
            loadingDone: null,
            importingDone: null,
            movingDone: null,
            mergingConsensusDone: null,
        },
        models: {
            inferenceDone: null,
        },
        auth: {
            changePasswordDone: null,
            registerDone: null,
            requestPasswordResetDone: null,
            resetPasswordDone: null,
        },
        projects: {
            restoringDone: null,
        },
        exporting: {
            dataset: null,
            annotation: null,
            backup: null,
        },
        importing: {
            dataset: null,
            annotation: null,
            backup: null,
        },
        invitations: {
            newInvitations: null,
            acceptInvitationDone: null,
            declineInvitationDone: null,
            resendingInvitation: null,
        },
    },
};

export default function (state = defaultState, action: AnyAction): NotificationsState {
    switch (action.type) {
        case AuthActionTypes.AUTHENTICATED_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    auth: {
                        ...state.errors.auth,
                        authenticated: {
                            message: t('Could not check authentication on the server'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AuthActionTypes.LOGIN_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    auth: {
                        ...state.errors.auth,
                        login: {
                            message: t('Could not login on the server'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-login-failed',
                        },
                    },
                },
            };
        }
        case AuthActionTypes.LOGOUT_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    auth: {
                        ...state.errors.auth,
                        logout: {
                            message: t('Could not logout from the server'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AuthActionTypes.REGISTER_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    auth: {
                        ...state.errors.auth,
                        register: {
                            message: t('Could not register on the server'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AuthActionTypes.REGISTER_SUCCESS: {
            if (!action.payload.isVerified) {
                return {
                    ...state,
                    messages: {
                        ...state.messages,
                        auth: {
                            ...state.messages.auth,
                            registerDone: {
                                message: t('To use your account, you need to confirm the email address.                                 We have sent an email with a confirmation link to {{userEmail}}.', { userEmail: action.payload.userEmail }),
                            },
                        },
                    },
                };
            }

            return {
                ...state,
            };
        }
        case AuthActionTypes.CHANGE_PASSWORD_SUCCESS: {
            return {
                ...state,
                messages: {
                    ...state.messages,
                    auth: {
                        ...state.messages.auth,
                        changePasswordDone: {
                            message: t('New password has been saved.'),
                            className: 'cvat-notification-notice-change-password-success',
                        },
                    },
                },
            };
        }
        case AuthActionTypes.CHANGE_PASSWORD_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    auth: {
                        ...state.errors.auth,
                        changePassword: {
                            message: t('Could not change password'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-change-password-failed',
                        },
                    },
                },
            };
        }
        case AuthActionTypes.REQUEST_PASSWORD_RESET_SUCCESS: {
            return {
                ...state,
                messages: {
                    ...state.messages,
                    auth: {
                        ...state.messages.auth,
                        requestPasswordResetDone: {
                            message: t('Check your email for a link to reset your password. If it doesn\'t appear within a few minutes, check your spam folder.'),
                        },
                    },
                },
            };
        }
        case AuthActionTypes.REQUEST_PASSWORD_RESET_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    auth: {
                        ...state.errors.auth,
                        requestPasswordReset: {
                            message: t('Could not reset password on the server.'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AuthActionTypes.RESET_PASSWORD_SUCCESS: {
            return {
                ...state,
                messages: {
                    ...state.messages,
                    auth: {
                        ...state.messages.auth,
                        resetPasswordDone: {
                            message: t('Password has been reset with the new password.'),
                        },
                    },
                },
            };
        }
        case AuthActionTypes.RESET_PASSWORD_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    auth: {
                        ...state.errors.auth,
                        resetPassword: {
                            message: t('Could not set new password on the server.'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AuthActionTypes.UPDATE_USER_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    auth: {
                        ...state.errors.auth,
                        updateUser: {
                            message: t('Could not update user information.'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ServerAPIActionTypes.GET_SERVER_API_SCHEMA_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    serverAPI: {
                        ...state.errors.serverAPI,
                        fetching: {
                            message: t('Could not receive server schema'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case InvitationsActionTypes.GET_INVITATIONS_SUCCESS: {
            if (action.payload.showNotification) {
                return {
                    ...state,
                    messages: {
                        ...state.messages,
                        invitations: {
                            ...state.messages.invitations,
                            newInvitations: {
                                message: t('You\'ve received an invitation to join an organization! [Click here](/invitations) to get details.'),
                            },
                        },
                    },
                };
            }
            return state;
        }
        case InvitationsActionTypes.GET_INVITATIONS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    invitations: {
                        ...state.errors.invitations,
                        fetching: {
                            message: t('Could not get invitations'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-get-invitations-failed',
                        },
                    },
                },
            };
        }
        case InvitationsActionTypes.ACCEPT_INVITATION_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    invitations: {
                        ...state.errors.invitations,
                        acceptingInvitation: {
                            message: t('Could not accept invitation'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-accept-organization-invitation-failed',
                        },
                    },
                },
            };
        }
        case InvitationsActionTypes.DECLINE_INVITATION_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    invitations: {
                        ...state.errors.invitations,
                        decliningInvitation: {
                            message: t('Could not decline invitation'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-decline-organization-invitation-failed',
                        },
                    },
                },
            };
        }
        case InvitationsActionTypes.RESEND_INVITATION_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    invitations: {
                        ...state.errors.invitations,
                        resendingInvitation: {
                            message: t('Could not resend invitation'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-resend-organization-invitation-failed',
                        },
                    },
                },
            };
        }
        case InvitationsActionTypes.RESEND_INVITATION_SUCCESS: {
            return {
                ...state,
                messages: {
                    ...state.messages,
                    invitations: {
                        ...state.messages.invitations,
                        resendingInvitation: {
                            message: t('Invitation was sent successfully'),
                        },
                    },
                },
            };
        }
        case ExportActionTypes.EXPORT_DATASET_FAILED: {
            const { instance, instanceType } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    exporting: {
                        ...state.errors.exporting,
                        dataset: {
                            message:
                                t('Could not export dataset for the [{{instanceType}} {{id}}](/{{instanceType}}s/{{id}})', { instanceType, id: instance.id }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ExportActionTypes.EXPORT_DATASET_SUCCESS: {
            const {
                instance, instanceType, resource, target,
            } = action.payload;
            let description = t('Export {{resource}} for {{instanceType}} {{id}} is finished. ', { resource, instanceType, id: instance.id });
            if (target === StorageLocation.LOCAL) {
                description += 'You can [download it here](/requests).';
            } else if (target === StorageLocation.CLOUD_STORAGE) {
                description =
                    t('Export {{resource}} for {{instanceType}} {{id}} has been uploaded to cloud storage.', { resource, instanceType, id: instance.id });
            }
            return {
                ...state,
                messages: {
                    ...state.messages,
                    exporting: {
                        ...state.messages.exporting,
                        dataset: {
                            message: t('Export is finished'),
                            duration: config.REQUEST_SUCCESS_NOTIFICATION_DURATION,
                            className: `cvat-notification-notice-export-${instanceType.split(' ')[0]}-finished`,
                            description,
                        },
                    },
                },
            };
        }
        case ExportActionTypes.EXPORT_BACKUP_FAILED: {
            const { instance, instanceType } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    exporting: {
                        ...state.errors.exporting,
                        backup: {
                            message:
                                t('Could not export the {{instanceType}} №{{id}}', { instanceType, id: instance.id }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ExportActionTypes.EXPORT_BACKUP_SUCCESS: {
            const {
                instance, instanceType, target,
            } = action.payload;
            let description = t('Backup for the {{instanceType}} {{id}} is finished. ', { instanceType, id: instance.id });
            if (target === StorageLocation.LOCAL) {
                description += 'You can [download it here](/requests).';
            } else if (target === StorageLocation.CLOUD_STORAGE) {
                description =
                    t('Backup for the {{instanceType}} {{id}} has been uploaded to cloud storage.', { instanceType, id: instance.id });
            }
            return {
                ...state,
                messages: {
                    ...state.messages,
                    exporting: {
                        ...state.messages.exporting,
                        backup: {
                            message: t('Backup export is finished'),
                            duration: config.REQUEST_SUCCESS_NOTIFICATION_DURATION,
                            description,
                        },
                    },
                },
            };
        }
        case ImportActionTypes.IMPORT_DATASET_SUCCESS: {
            const { instance, resource } = action.payload;
            let description = resource === 'annotation' ? t('Annotations have been loaded to the ') : t('Dataset was imported to the ');
            const instanceType = getInstanceType(instance);
            if (instanceType === 'project') {
                description += `[Project #${instance.id}](/projects/${instance.id})`;
            } else if (instanceType === 'task') {
                description += `[Task #${instance.id}](/tasks/${instance.id})`;
            } else {
                description += `[Job #${instance.id}](/tasks/${instance.taskId}/jobs/${instance.id})`;
            }

            return {
                ...state,
                messages: {
                    ...state.messages,
                    importing: {
                        ...state.messages.importing,
                        [resource]: {
                            message: t('Annotations import is finished'),
                            duration: config.REQUEST_SUCCESS_NOTIFICATION_DURATION,
                            description,
                        },
                    },
                },
            };
        }
        case ImportActionTypes.IMPORT_DATASET_FAILED: {
            const { instance, resource } = action.payload;
            const message = resource === 'annotation' ? t('Could not upload annotation for the [task #{{value}}](/tasks/{{value}})', { value: instance?.taskId || instance.id }) : t('Could not import dataset to the [project #{{id}}](/projects/{{id}})', { id: instance.id });
            return {
                ...state,
                errors: {
                    ...state.errors,
                    importing: {
                        ...state.errors.importing,
                        dataset: {
                            message,
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-' +
                                `${resource === 'annotation' ? 'load-annotation' : 'import-dataset'}-failed`,
                        },
                    },
                },
            };
        }
        case ImportActionTypes.IMPORT_BACKUP_SUCCESS: {
            const { instanceId, instanceType } = action.payload;
            const description = t('The {{instanceType}} has been restored successfully. Click [here](/{{instanceType}}s/{{instanceId}}) to open', { instanceType, instanceId });
            return {
                ...state,
                messages: {
                    ...state.messages,
                    importing: {
                        ...state.messages.importing,
                        backup: {
                            message: t('Import backup is finished'),
                            duration: config.REQUEST_SUCCESS_NOTIFICATION_DURATION,
                            description,
                        },
                    },
                },
            };
        }
        case ImportActionTypes.IMPORT_BACKUP_FAILED: {
            const { instanceType } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    importing: {
                        ...state.errors.importing,
                        backup: {
                            message:
                                t('Could not restore {{instanceType}} backup.', { instanceType }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case TasksActionTypes.GET_TASKS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    tasks: {
                        ...state.errors.tasks,
                        fetching: {
                            message: t('Could not fetch tasks'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case TasksActionTypes.DELETE_TASK_FAILED: {
            const { taskID } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    tasks: {
                        ...state.errors.tasks,
                        deleting: {
                            message: t('Could not delete the [task #{{taskID}}](/tasks/{{taskID}})', { taskID }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-delete-task-failed',
                        },
                    },
                },
            };
        }
        case TasksActionTypes.UPDATE_TASK_FAILED: {
            const { taskId, error, updateType } = action.payload;
            let message = t('Could not update the [task #{{taskId}}](/tasks/{{taskId}})', { taskId });

            if (updateType === ResourceUpdateTypes.UPDATE_ORGANIZATION) {
                message = t('Could not transfer the [task #{{taskId}}](/tasks/{{taskId}}) to the new workspace', { taskId });
            }

            return {
                ...state,
                errors: {
                    ...state.errors,
                    tasks: {
                        ...state.errors.tasks,
                        updating: {
                            message,
                            reason: error.toString(),
                            shouldLog: shouldLog(error),
                            className: 'cvat-notification-notice-update-task-failed',
                        },
                    },
                },
            };
        }
        case ConsensusActionTypes.MERGE_CONSENSUS_JOBS_SUCCESS: {
            const { instance } = action.payload;
            let message = '';
            const instanceType = getInstanceType(instance);
            if (instanceType === 'job') {
                message =
                    t('Consensus [job #{{id}}](/tasks/{{taskId}}/jobs/{{id}}) has been merged', { id: instance.id, taskId: instance.taskId });
            } else if (instanceType === 'task') {
                message = t('Consensus jobs in the [task #{{id}}](/tasks/{{id}}) have been merged', { id: instance.id });
            }
            return {
                ...state,
                messages: {
                    ...state.messages,
                    tasks: {
                        ...state.messages.tasks,
                        mergingConsensusDone: {
                            message,
                        },
                    },
                },
            };
        }
        case ConsensusActionTypes.MERGE_CONSENSUS_JOBS_FAILED: {
            const { instance } = action.payload;
            let message = '';
            const instanceType = getInstanceType(instance);
            if (instanceType === 'job') {
                message =
                    t('Could not merge the [job #{{id}}](/tasks/{{taskId}}/jobs/{{id}})', { id: instance.id, taskId: instance.taskId });
            } else if (instanceType === 'task') {
                message = t('Could not merge the [task #{{id}}](/tasks/{{id}})', { id: instance.id });
            }
            return {
                ...state,
                errors: {
                    ...state.errors,
                    tasks: {
                        ...state.errors.tasks,
                        mergingConsensus: {
                            message,
                            reason: action.payload.error,
                            shouldLog: !(action.payload.error instanceof ServerError),
                            className: 'cvat-notification-notice-consensus-merge-task-failed',
                        },
                    },
                },
            };
        }
        case TasksActionTypes.CREATE_TASK_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    tasks: {
                        ...state.errors.tasks,
                        creating: {
                            message: t('Could not create the task'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-create-task-failed',
                        },
                    },
                },
            };
        }
        case ProjectsActionTypes.GET_PROJECTS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    projects: {
                        ...state.errors.projects,
                        fetching: {
                            message: t('Could not fetch projects'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ProjectsActionTypes.CREATE_PROJECT_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    projects: {
                        ...state.errors.projects,
                        creating: {
                            message: t('Could not create the project'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-create-project-failed',
                        },
                    },
                },
            };
        }
        case ProjectsActionTypes.DELETE_PROJECT_FAILED: {
            const { projectId } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    projects: {
                        ...state.errors.projects,
                        updating: {
                            message: t('Could not delete [project #{{projectId}}](/project/{{projectId}})', { projectId }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-delete-project-failed',
                        },
                    },
                },
            };
        }
        case ProjectsActionTypes.UPDATE_PROJECT_FAILED: {
            const { projectId, error, updateType } = action.payload;
            let message = t('Could not update the [project #{{projectId}}](/projects/{{projectId}})', { projectId });

            if (updateType === ResourceUpdateTypes.UPDATE_ORGANIZATION) {
                message = t('Could not transfer the [project #{{projectId}}](/projects/{{projectId}}) to the new workspace', { projectId });
            }

            return {
                ...state,
                errors: {
                    ...state.errors,
                    projects: {
                        ...state.errors.projects,
                        creating: {
                            message,
                            reason: error.toString(),
                            className: 'cvat-notification-notice-update-project-failed',
                            shouldLog: shouldLog(error),
                        },
                    },
                },
            };
        }
        case FormatsActionTypes.GET_FORMATS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    formats: {
                        ...state.errors.formats,
                        fetching: {
                            message: t('Could not get formats from the server'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AboutActionTypes.GET_ABOUT_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    about: {
                        ...state.errors.about,
                        fetching: {
                            message: t('Could not get info about the server'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ModelsActionTypes.GET_INFERENCE_STATUS_SUCCESS: {
            if (action.payload.activeInference.status === 'finished') {
                const { taskID } = action.payload;
                return {
                    ...state,
                    messages: {
                        ...state.messages,
                        models: {
                            ...state.messages.models,
                            inferenceDone: {
                                message: t('Automatic annotation accomplished for the [task #{{taskID}}](/tasks/{{taskID}})', { taskID }),
                            },
                        },
                    },
                };
            }

            return {
                ...state,
            };
        }
        case ModelsActionTypes.FETCH_META_FAILED: {
            if (action.payload.error.code === 403) {
                return state;
            }

            return {
                ...state,
                errors: {
                    ...state.errors,
                    models: {
                        ...state.errors.models,
                        metaFetching: {
                            message: t('Could not fetch models meta information'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ModelsActionTypes.GET_INFERENCE_STATUS_FAILED: {
            const { taskID } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    models: {
                        ...state.errors.models,
                        inferenceStatusFetching: {
                            message: t('Fetching inference status for the [task #{{taskID}}](/tasks/{{taskID}})', { taskID }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ModelsActionTypes.GET_MODELS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    models: {
                        ...state.errors.models,
                        fetching: {
                            message: t('Could not get models from the server'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ModelsActionTypes.START_INFERENCE_FAILED: {
            const { taskID } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    models: {
                        ...state.errors.models,
                        starting: {
                            message: t('Could not infer model for the [task #{{taskID}}](/tasks/{{taskID}})', { taskID }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ModelsActionTypes.CANCEL_INFERENCE_FAILED: {
            const { taskID } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    models: {
                        ...state.errors.models,
                        canceling: {
                            message: t('Could not cancel model inference for the [task #{{taskID}}](/tasks/{{taskID}})', { taskID }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.GET_JOB_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        jobFetching: {
                            message: t('Error during fetching a job'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-fetch-job-failed',
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.CHANGE_FRAME_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        frameFetching: {
                            message: t('Could not receive frame {{number}}', { number: action.payload.number }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.SAVE_ANNOTATIONS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        saving: {
                            message: t('Could not save annotations'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-save-annotations-failed',
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.UPDATE_ANNOTATIONS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        updating: {
                            message: t('Could not update annotations'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-update-annotations-failed',
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.CREATE_ANNOTATIONS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        creating: {
                            message: t('Could not create annotations'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.MERGE_ANNOTATIONS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        merging: {
                            message: t('Could not merge annotations'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.GROUP_ANNOTATIONS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        grouping: {
                            message: t('Could not group annotations'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.JOIN_ANNOTATIONS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        joining: {
                            message: t('Could not join annotations'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.SLICE_ANNOTATIONS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        slicing: {
                            message: t('Could not slice the object'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.SPLIT_ANNOTATIONS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        splitting: {
                            message: t('Could not split the track'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.REMOVE_OBJECT_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        removing: {
                            message: t('Could not remove the object'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-remove-object-failed',
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.PROPAGATE_OBJECT_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        propagating: {
                            message: t('Could not propagate the object'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.COLLECT_STATISTICS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        collectingStatistics: {
                            message: t('Could not collect annotations statistics'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.UPLOAD_JOB_ANNOTATIONS_FAILED: {
            const { job, error } = action.payload;

            const {
                id: jobID,
                taskId: taskID,
            } = job;

            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        uploadAnnotations: {
                            message:
                                t('Could not upload annotations for the [job {{jobID}}](/tasks/{{taskID}}/jobs/{{jobID}})', { jobID, taskID }),
                            reason: error.toString(),
                            className: 'cvat-notification-notice-upload-annotations-fail',
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.REMOVE_JOB_ANNOTATIONS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        removeAnnotations: {
                            message: t('Could not remove annotations'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.FETCH_ANNOTATIONS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        fetchingAnnotations: {
                            message: t('Could not fetch annotations'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.REDO_ACTION_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        redo: {
                            message: t('Could not redo'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.UNDO_ACTION_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        undo: {
                            message: t('Could not undo'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.SEARCH_ANNOTATIONS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        search: {
                            message: t('Could not execute search annotations'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.SAVE_LOGS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        savingLogs: {
                            message: t('Could not send logs to the server'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case BoundariesActionTypes.THROW_RESET_ERROR: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    boundaries: {
                        ...state.errors.annotation,
                        resetError: {
                            message: t('Could not reset the state'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case UserAgreementsActionTypes.GET_USER_AGREEMENTS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    userAgreements: {
                        ...state.errors.userAgreements,
                        fetching: {
                            message: t('Could not get user agreements from the server'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ReviewActionTypes.FINISH_ISSUE_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    review: {
                        ...state.errors.review,
                        finishingIssue: {
                            message: t('Could not open a new issue'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ReviewActionTypes.RESOLVE_ISSUE_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    review: {
                        ...state.errors.review,
                        resolvingIssue: {
                            message: t('Could not resolve the issue'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ReviewActionTypes.REOPEN_ISSUE_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    review: {
                        ...state.errors.review,
                        reopeningIssue: {
                            message: t('Could not reopen the issue'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case RequestsActionsTypes.GET_REQUESTS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    requests: {
                        ...state.errors.requests,
                        fetching: {
                            message: t('Could not fetch requests from the server'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case RequestsActionsTypes.CANCEL_REQUEST_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    requests: {
                        ...state.errors.requests,
                        canceling: {
                            message: t('Could not cancel the request'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case RequestsActionsTypes.DELETE_REQUEST_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    requests: {
                        ...state.errors.requests,
                        deleting: {
                            message: t('Could not delete the request'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ReviewActionTypes.COMMENT_ISSUE_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    review: {
                        ...state.errors.review,
                        commentingIssue: {
                            message: t('Could not comment the issue'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ReviewActionTypes.SUBMIT_REVIEW_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    review: {
                        ...state.errors.review,
                        submittingReview: {
                            message: t('Could not submit review for the job {{jobId}}', { jobId: action.payload.jobId }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case ReviewActionTypes.REMOVE_ISSUE_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    review: {
                        ...state.errors.review,
                        deletingIssue: {
                            message: t('Could not remove issue from the server'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case NotificationsActionType.RESET_ERRORS: {
            return {
                ...state,
                errors: {
                    ...defaultState.errors,
                },
            };
        }
        case NotificationsActionType.RESET_MESSAGES: {
            return {
                ...state,
                messages: {
                    ...defaultState.messages,
                },
            };
        }
        case AnnotationActionTypes.GET_DATA_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        jobFetching: {
                            message: t('Could not receive image data'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-fetch-frame-data-from-the-server-failed',
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.CANVAS_ERROR_OCCURRED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        canvas: {
                            message: t('Canvas error occurred'),
                            reason: action.payload.error,
                            shouldLog: true,
                            className: 'cvat-notification-notice-canvas-error-occurred',
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.DELETE_FRAME_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        deleteFrame: {
                            message: t('Could not delete frame'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case AnnotationActionTypes.RESTORE_FRAME_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    annotation: {
                        ...state.errors.annotation,
                        restoreFrame: {
                            message: t('Could not restore frame'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case CloudStorageActionTypes.GET_CLOUD_STORAGE_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    cloudStorages: {
                        ...state.errors.cloudStorages,
                        fetching: {
                            message: t('Could not fetch cloud storage'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                        },
                    },
                },
            };
        }
        case CloudStorageActionTypes.CREATE_CLOUD_STORAGE_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    cloudStorages: {
                        ...state.errors.cloudStorages,
                        creating: {
                            message: t('Could not create the cloud storage'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-create-cloud-storage-failed',
                        },
                    },
                },
            };
        }
        case CloudStorageActionTypes.UPDATE_CLOUD_STORAGE_FAILED: {
            const { cloudStorage, error } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    cloudStorages: {
                        ...state.errors.cloudStorages,
                        updating: {
                            message: t('Could not update cloud storage #{{id}}', { id: cloudStorage.id }),
                            reason: error.toString(),
                            className: 'cvat-notification-notice-update-cloud-storage-failed',
                        },
                    },
                },
            };
        }
        case CloudStorageActionTypes.DELETE_CLOUD_STORAGE_FAILED: {
            const { cloudStorageID } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    cloudStorages: {
                        ...state.errors.cloudStorages,
                        deleting: {
                            message:
                                t('Could not delete cloud storage {{cloudStorageID}}', { cloudStorageID }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-delete-cloud-storage-failed',
                        },
                    },
                },
            };
        }
        case CloudStorageActionTypes.LOAD_CLOUD_STORAGE_CONTENT_FAILED: {
            const { cloudStorageID } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    cloudStorages: {
                        ...state.errors.cloudStorages,
                        fetching: {
                            message: t('Could not fetch content for cloud storage #{{cloudStorageID}}', { cloudStorageID }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-fetch-cloud-storage-content-failed',
                        },
                    },
                },
            };
        }
        case CloudStorageActionTypes.GET_CLOUD_STORAGE_STATUS_FAILED: {
            const { cloudStorageID } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    cloudStorages: {
                        ...state.errors.cloudStorages,
                        fetching: {
                            message: t('Could not fetch cloud storage #{{cloudStorageID}} status', { cloudStorageID }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-fetch-cloud-storage-status-failed',
                        },
                    },
                },
            };
        }

        case CloudStorageActionTypes.GET_CLOUD_STORAGE_PREVIEW_FAILED: {
            const { cloudStorageID } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    cloudStorages: {
                        ...state.errors.cloudStorages,
                        fetching: {
                            message: t('Could not fetch preview for cloud storage #{{cloudStorageID}}', { cloudStorageID }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-fetch-cloud-storage-preview-failed',
                        },
                    },
                },
            };
        }
        case OrganizationActionsTypes.CREATE_ORGANIZATION_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    organizations: {
                        ...state.errors.organizations,
                        creating: {
                            message: t('Could not create organization {{slug}}', { slug: action.payload.slug }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-create-organization-failed',
                        },
                    },
                },
            };
        }
        case OrganizationActionsTypes.UPDATE_ORGANIZATION_FAILED: {
            const { slug } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    organizations: {
                        ...state.errors.organizations,
                        updating: {
                            message: t('Could not update organization "{{slug}}"', { slug }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-update-organization-failed',
                        },
                    },
                },
            };
        }
        case OrganizationActionsTypes.ACTIVATE_ORGANIZATION_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    organizations: {
                        ...state.errors.organizations,
                        activation: {
                            message: t('Could not activate organization {{value}}', { value: action.payload.slug || '' }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-activate-organization-failed',
                        },
                    },
                },
            };
        }
        case OrganizationActionsTypes.REMOVE_ORGANIZATION_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    organizations: {
                        ...state.errors.organizations,
                        deleting: {
                            message: t('Could not remove organization {{slug}}', { slug: action.payload.slug }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-remove-organization-failed',
                        },
                    },
                },
            };
        }
        case OrganizationActionsTypes.INVITE_ORGANIZATION_MEMBERS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    organizations: {
                        ...state.errors.organizations,
                        inviting: {
                            message: t('Could not invite organization members'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-invite-organization-members-failed',
                        },
                    },
                },
            };
        }
        case OrganizationActionsTypes.INVITE_ORGANIZATION_MEMBER_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    organizations: {
                        ...state.errors.organizations,
                        inviting: {
                            message: t('Could not invite this member "{{email}}" to the organization', { email: action.payload.email }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-invite-organization-member-failed',
                        },
                    },
                },
            };
        }
        case OrganizationActionsTypes.LEAVE_ORGANIZATION_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    organizations: {
                        ...state.errors.organizations,
                        leaving: {
                            message: t('Could not leave the organization'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-leave-organization-failed',
                        },
                    },
                },
            };
        }
        case OrganizationActionsTypes.REMOVE_ORGANIZATION_MEMBER_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    organizations: {
                        ...state.errors.organizations,
                        removingMembership: {
                            message: t('Could not remove member "{{username}}" from the organization', { username: action.payload.username }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-remove-organization-member-failed',
                        },
                    },
                },
            };
        }
        case OrganizationActionsTypes.UPDATE_ORGANIZATION_MEMBER_FAILED: {
            const { role, username } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    organizations: {
                        ...state.errors.organizations,
                        updatingMembership: {
                            message: t('Could not assign role "{{role}}" to the user "{{username}}"', { role, username }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-update-organization-membership-failed',
                        },
                    },
                },
            };
        }
        case OrganizationActionsTypes.GET_ORGANIZATIONS_FAILED: {
            const { error } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    organizations: {
                        ...state.errors.organizations,
                        fetching: {
                            message: t('Could not fetch the list of organizations'),
                            reason: error,
                            shouldLog: shouldLog(error),
                        },
                    },
                },
            };
        }
        case JobsActionTypes.GET_JOBS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    jobs: {
                        ...state.errors.jobs,
                        fetching: {
                            message: t('Could not fetch a list of jobs'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-get-jobs-failed',
                        },
                    },
                },
            };
        }
        case JobsActionTypes.CREATE_JOB_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    jobs: {
                        ...state.errors.jobs,
                        creating: {
                            message: t('Could not create job'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-create-job-failed',
                        },
                    },
                },
            };
        }
        case JobsActionTypes.UPDATE_JOB_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    jobs: {
                        ...state.errors.jobs,
                        updating: {
                            message: t('Could not update job'),
                            reason: action.payload.error.toString(),
                            className: 'cvat-notification-notice-update-job-failed',
                        },
                    },
                },
            };
        }
        case JobsActionTypes.DELETE_JOB_FAILED: {
            const { jobID } = action.payload;
            return {
                ...state,
                errors: {
                    ...state.errors,
                    jobs: {
                        ...state.errors.jobs,
                        deleting: {
                            message: t('Could not delete the job #{{jobID}}', { jobID }),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-delete-job-failed',
                        },
                    },
                },
            };
        }
        case WebhooksActionsTypes.GET_WEBHOOKS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    webhooks: {
                        ...state.errors.webhooks,
                        fetching: {
                            message: t('Could not fetch a list of webhooks'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-get-webhooks-failed',
                        },
                    },
                },
            };
        }
        case WebhooksActionsTypes.CREATE_WEBHOOK_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    webhooks: {
                        ...state.errors.webhooks,
                        creating: {
                            message: t('Could not create webhook'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-create-webhook-failed',
                        },
                    },
                },
            };
        }
        case WebhooksActionsTypes.UPDATE_WEBHOOK_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    webhooks: {
                        ...state.errors.webhooks,
                        updating: {
                            message: t('Could not update webhook'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-update-webhook-failed',
                        },
                    },
                },
            };
        }
        case WebhooksActionsTypes.DELETE_WEBHOOK_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    webhooks: {
                        ...state.errors.webhooks,
                        deleting: {
                            message: t('Could not delete webhook'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-delete-webhook-failed',
                        },
                    },
                },
            };
        }
        case BulkActionsTypes.BULK_OPERATION_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    bulkOperation: {
                        ...state.errors.bulkOperation,
                        processing: {
                            message: t('Bulk operation failed.'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-bulk-operation-failed',
                            remainingItemsCount: action.payload.remainingItemsCount,
                            retryPayload: action.payload.retryPayload,
                            ignore: true,
                        },
                    },
                },
            };
        }
        case AuthActionTypes.GET_API_TOKENS_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    auth: {
                        ...state.errors.auth,
                        getApiTokens: {
                            message: t('Could not get API tokens'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-get-api-tokens-failed',
                        },
                    },
                },
            };
        }
        case AuthActionTypes.CREATE_API_TOKEN_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    auth: {
                        ...state.errors.auth,
                        createApiToken: {
                            message: t('Could not create API token'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-create-api-token-failed',
                        },
                    },
                },
            };
        }
        case AuthActionTypes.UPDATE_API_TOKEN_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    auth: {
                        ...state.errors.auth,
                        updateApiToken: {
                            message: t('Could not update API token'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-update-api-token-failed',
                        },
                    },
                },
            };
        }
        case AuthActionTypes.REVOKE_API_TOKEN_FAILED: {
            return {
                ...state,
                errors: {
                    ...state.errors,
                    auth: {
                        ...state.errors.auth,
                        revokeApiToken: {
                            message: t('Could not revoke API token'),
                            reason: action.payload.error,
                            shouldLog: shouldLog(action.payload.error),
                            className: 'cvat-notification-notice-revoke-api-token-failed',
                        },
                    },
                },
            };
        }
        case BoundariesActionTypes.RESET_AFTER_ERROR:
        case AuthActionTypes.LOGOUT_SUCCESS: {
            return { ...defaultState };
        }
        default: {
            return state;
        }
    }
}
