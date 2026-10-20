// electron-builder "beforeBuild" hook. The app has no runtime npm dependencies (package.json
// "files" excludes node_modules), so there is nothing to rebuild or collect. Returning false
// tells electron-builder that node_modules are handled externally, which also skips its slow
// search of the repository's yarn workspace for dependencies.
module.exports = async function beforeBuild() {
    return false;
};
