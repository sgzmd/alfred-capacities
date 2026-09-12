#!/usr/bin/env osascript -l JavaScript

function logError(msg) {
    $.NSLog("alfred-capacities ERROR: " + msg);
}

function logInfo(msg) {
    $.NSLog("alfred-capacities: " + msg);
}

function run(argv) {
    const env = $.NSProcessInfo.processInfo.environment;
    const token = env.objectForKey("CAPACITIES_TOKEN")?.js;

    if (!token) {
        logError("Capacities API Token is missing.");
        return JSON.stringify({
            items: [{
                title: "API Token Missing",
                subtitle: "Please configure your CAPACITIES_TOKEN in the workflow settings panel.",
                valid: false
            }]
        });
    }

    try {
        const app = Application.currentApplication();
        app.includeStandardAdditions = true;
        
        // Escape the token for curl command string safely
        const escapedToken = token.replace(/'/g, "'\\''");
        const cmd = `curl -s -X GET "https://api.capacities.io/spaces" -H 'Authorization: Bearer ${escapedToken}'`;
        const responseText = app.doShellScript(cmd);
        
        if (!responseText || responseText.trim() === "") {
            throw new Error("Empty response from API");
        }

        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            logError(`Failed to parse API response: ${responseText}`);
            return JSON.stringify({
                items: [{
                    title: "API Response Parse Error",
                    subtitle: `Failed to parse response: ${responseText}`,
                    valid: false
                }]
            });
        }

        if (data.code || data.error) {
            const msg = data.message || responseText;
            logError(`API error: ${msg}`);
            return JSON.stringify({
                items: [{
                    title: "API Request Error",
                    subtitle: `Check your token. API response: ${msg}`,
                    valid: false
                }]
            });
        }
        
        const spaces = data.spaces || [];
        if (spaces.length === 0) {
            return JSON.stringify({
                items: [{
                    title: "No spaces found",
                    subtitle: "Check your Capacities account.",
                    valid: false
                }]
            });
        }
        
        const items = spaces.map(s => {
            const sid = s.id;
            const title = s.title;
            const iconData = s.icon || {};
            const emoji = (iconData.type === "emoji") ? (iconData.val || "🚀") : "🚀";
            
            return {
                uid: sid,
                title: `${emoji} ${title}`,
                subtitle: `Select to set as target space (ID: ${sid})`,
                arg: sid,
                variables: {
                    space_title: title
                }
            };
        });
        
        logInfo(`Fetched ${spaces.length} space(s).`);
        return JSON.stringify({ items });
    } catch (e) {
        logError(e.message || String(e));
        return JSON.stringify({
            items: [{
                title: "Error fetching or parsing spaces",
                subtitle: e.message || String(e),
                valid: false
            }]
        });
    }
}
