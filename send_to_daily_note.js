#!/usr/bin/env osascript -l JavaScript

function logError(msg) {
    $.NSLog("alfred-capacities ERROR: " + msg);
}

function logInfo(msg) {
    $.NSLog("alfred-capacities: " + msg);
}

function run(argv) {
    const inputText = argv[0];

    if (!inputText || inputText.trim() === "") {
        logError("Note content is empty.");
        return "ERROR: Note content is empty.";
    }

    const env = $.NSProcessInfo.processInfo.environment;
    const token = env.objectForKey("CAPACITIES_TOKEN")?.js;
    const spaceId = env.objectForKey("CAPACITIES_SPACE_ID")?.js;

    if (!token) {
        logError("Capacities API Token is missing.");
        return "ERROR: Capacities API Token is missing. Please configure it in workflow settings.";
    }

    if (!spaceId) {
        logError("Space ID is not set.");
        return "ERROR: Space ID is not set. Run 'cap:space' in Alfred to select your space first.";
    }

    try {
        const app = Application.currentApplication();
        app.includeStandardAdditions = true;

        // Construct payload safely using native JSON serialization
        const payload = JSON.stringify({
            spaceId: spaceId,
            mdText: inputText
        });

        // Escape token and payload for curl command
        const escapedToken = token.replace(/'/g, "'\\''");
        const escapedPayload = payload.replace(/'/g, "'\\''");

        const cmd = `curl -s -X POST "https://api.capacities.io/save-to-daily-note" \
            -H 'Authorization: Bearer ${escapedToken}' \
            -H 'Content-Type: application/json' \
            -d '${escapedPayload}'`;

        const responseText = app.doShellScript(cmd);

        if (!responseText || responseText.trim() === "") {
            logInfo("Note added successfully.");
            return "Note added successfully!";
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            logError(`Failed to parse API response: ${responseText}`);
            return `ERROR: Failed to parse API response: ${responseText}`;
        }

        if (data.code || data.error) {
            const errMsg = data.message || responseText;
            logError(`API error: ${errMsg}`);
            return `ERROR: ${errMsg}`;
        }

        logInfo(`Note added successfully: ${responseText}`);
        return "Note added successfully!";
    } catch (e) {
        logError(e.message || String(e));
        return `ERROR: ${e.message || String(e)}`;
    }
}
