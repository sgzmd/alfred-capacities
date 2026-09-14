#!/usr/bin/env osascript -l JavaScript
//
// cap:setup — one-time bootstrap. Verifies token, discovers a note-like
// structure id, finds or creates the DailyLog tag, and persists both ids into
// workflow configuration.

function run(argv) {
    (function () {
        ObjC.import('Foundation');
        const dir = scriptDirFallback();
        const boot = $.NSString.stringWithContentsOfFileEncodingError(
            dir + '/jxa-bootstrap.js', $.NSUTF8StringEncoding, null);
        if (boot.isNil()) throw new Error('cannot read jxa-bootstrap.js at ' + dir);
        (0, eval)(String(boot.js));
    })();

    loadModule('runner.js');
    loadModule('ops.js');
    loadModule('flows.js');
    loadModule('transport/jxa.js');

    const token = readEnv('CAPACITIES_TOKEN');
    if (!token) return 'ERROR: CAPACITIES_TOKEN missing. Configure it in the workflow settings.';

    const transport = jxaTransport.makeJxaTransport({ token: token });

    try {
        const result = flows.setup(transport);
        saveConfig('CAPACITIES_LOG_STRUCTURE_ID', result.structureId);
        saveConfig('CAPACITIES_LOG_STRUCTURE_TITLE', result.structureTitle);
        saveConfig('CAPACITIES_SPACE_TITLE', result.space.title || '');
        return `Space ${result.space.title || result.space.id} ready · captures → ${result.structureTitle}`;
    } catch (e) {
        $.NSLog('alfred-capacities ERROR: ' + (e.message || String(e)));
        return 'ERROR: ' + (e.message || String(e));
    }
}

function scriptDirFallback() {
    const argv = $.NSProcessInfo.processInfo.arguments;
    for (let i = 0; i < argv.count; i++) {
        const a = ObjC.unwrap(argv.objectAtIndex(i));
        if (a && a.endsWith('.js') && a.indexOf('/') >= 0) {
            return a.substring(0, a.lastIndexOf('/'));
        }
    }
    return String($.NSFileManager.defaultManager.currentDirectoryPath.js || '.');
}
