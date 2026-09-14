// jxa-bootstrap.js — helpers each JXA entry script inlines/loads at the top.
//
// Provides:
//   loadModule(relPath)    — read and eval a sibling file into globalThis.
//   awaitPromise(p)        — synchronously wait on a Promise by pumping the
//                            current runloop. Works because our jxaTransport
//                            blocks on a dispatch semaphore, so every `await`
//                            resolves on the next microtask.
//   readEnv(name)          — read a workflow env var, undefined if missing.
//   scriptDir()            — absolute path of the running .js file.
//
// This file is itself loaded by each entry script the same way, so it must be
// idempotent under re-eval.

(function (root) {
    'use strict';
    if (root.__capBootstrapLoaded) return;
    root.__capBootstrapLoaded = true;

    ObjC.import('Foundation');
    ObjC.import('Cocoa'); // NSMutableURLRequest / NSURLSession live here on macOS 15+.

    function scriptDir() {
        // NSProcessInfo.arguments[0..] contains osascript's argv. The script
        // path is arguments[3] under `osascript -l JavaScript path arg1 ...`.
        const argv = $.NSProcessInfo.processInfo.arguments;
        for (let i = 0; i < argv.count; i++) {
            const a = ObjC.unwrap(argv.objectAtIndex(i));
            if (a && a.endsWith('.js') && a.indexOf('/') >= 0) {
                return a.substring(0, a.lastIndexOf('/'));
            }
        }
        // Fallback: current working directory.
        return String($.NSFileManager.defaultManager.currentDirectoryPath.js || '.');
    }

    function loadModule(relPath) {
        const dir = scriptDir();
        const full = dir + '/' + relPath;
        const content = $.NSString.stringWithContentsOfFileEncodingError(
            full, $.NSUTF8StringEncoding, null,
        );
        if (content.isNil()) {
            throw new Error('loadModule: cannot read ' + full);
        }
        // eval in global scope so `(function(root){ ... })(globalThis)` blocks
        // in each module attach to globalThis rather than a nested scope.
        (0, eval)(String(content.js));
    }

    function readEnv(name) {
        const v = $.NSProcessInfo.processInfo.environment.objectForKey(name);
        if (!v || v.isNil()) return undefined;
        return String(v.js);
    }

    function saveConfig(key, value) {
        // Persist a value into Alfred workflow configuration so it survives.
        const alfred = Application('Alfred 5');
        alfred.setConfiguration(key, {
            toValue: String(value),
            inWorkflow: 'cc.kirillov.alfred-capacities',
        });
    }

    root.loadModule = loadModule;
    root.readEnv = readEnv;
    root.scriptDir = scriptDir;
    root.saveConfig = saveConfig;
})(this);
