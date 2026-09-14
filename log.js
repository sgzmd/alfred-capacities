#!/usr/bin/env osascript -l JavaScript
//
// cap:log <range> — Alfred script filter listing DailyLog captures for a
// date range. `range` is any expression parseRangeExpression accepts: empty,
// "today", "week", an integer N, or "YYYY-MM-DD..YYYY-MM-DD".

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
    const structureId = readEnv('CAPACITIES_LOG_STRUCTURE_ID');
    if (!token) return alfredError('CAPACITIES_TOKEN missing', 'Set it in workflow settings.');
    if (!structureId) return alfredError('Not set up', 'Run `cap:setup` in Alfred first.');

    let range;
    try {
        range = runner.parseRangeExpression(argv[0], new Date());
    } catch (e) {
        return alfredError('Bad range', e.message);
    }

    const transport = jxaTransport.makeJxaTransport({ token: token });

    let objects;
    try {
        objects = flows.listInRange(transport, {
            structureId: structureId,
            from: range.from,
            to: range.to,
        });
    } catch (e) {
        return alfredError('API error', e.message || String(e));
    }

    if (objects.length === 0) {
        return alfredEmpty(range);
    }

    const items = objects.map((o) => {
        const when = o.createdAt ? formatWhen(o.createdAt) : '';
        const title = o.title || '(untitled)';
        const deepLink = o.deepLink || o.url || '';
        return {
            uid: o.id,
            title: title,
            subtitle: when + (deepLink ? '  ⏎ open in Capacities' : ''),
            arg: deepLink || o.id,
            variables: { object_id: o.id },
        };
    });
    return JSON.stringify({ items: items });
}

function formatWhen(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    // Local, short: "Wed 15:47".
    const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return wk + ' ' + hh + ':' + mm;
}

function alfredError(title, subtitle) {
    return JSON.stringify({
        items: [{
            title: title,
            subtitle: subtitle,
            valid: false,
        }],
    });
}

function alfredEmpty(range) {
    return JSON.stringify({
        items: [{
            title: 'No captures in range',
            subtitle: range.from.toISOString().slice(0, 10) + ' → ' + range.to.toISOString().slice(0, 10),
            valid: false,
        }],
    });
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
