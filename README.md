# Capacities Quick Capture for Alfred

If you use [Capacities](https://capacities.io) for note-taking and [Alfred](https://www.alfredapp.com) for navigating your Mac, you have probably wondered why there isn't a dead-simple, zero-friction way to dump quick thoughts straight into your daily note.

Well, now there is. 

This is a lightweight, zero-dependency Alfred workflow designed to let you append text to your Capacities daily note in a fraction of a second. No Electron apps opening, no context switching—just trigger Alfred, type, and get back to what you were doing.

## Why this exists

Many existing Alfred workflows rely on Python 3 for parsing JSON. While that works fine in theory, Apple stopped shipping Python by default in macOS Monterey. Forcing users to download Xcode Command Line Tools just to parse a bit of JSON seems like an incredibly poor user experience.

This workflow is written entirely using **JXA (JavaScript for Automation)**. It runs natively on macOS out of the box, with zero external dependencies and zero setup overhead.

Additionally, care has been taken to make it secure. Instead of interpolating raw user input directly into shell commands (which is a recipe for JSON breakout and command injection bugs), it serialises the payload natively and handles all escaping before talking to the Capacities API.

## Installation

1. Download the latest release: [Capacities_Quick_Capture.alfredworkflow](Capacities_Quick_Capture.alfredworkflow).
2. Double-click the file to import it into Alfred.
3. Configure your **Capacities API Token** in the workflow settings panel. You can generate a token in the Capacities desktop app under **Settings > Capacities API**.

## Usage

### 1. Select your active space
Before sending notes, you need to tell the workflow which space to target. 

- Trigger Alfred and type `cap:space`.
- Select your target space from the list. The workflow will persistently save your choice.

### 2. Capture a note
- Trigger Alfred and type `cap <your note>`.
- Press `Enter`.
- You will receive a system notification confirming the note has been added.

## Packaging and Development

If you want to modify the workflow or package it yourself from the source files, there is a simple script to handle it. 

Alfred workflows are essentially renamed zip archives containing the metadata and scripts. To package the workflow without dragging in macOS metadata clutter (like `.DS_Store` files), run:

```bash
./package.sh
```

This will bundle the necessary files (`info.plist`, `icon.png`, and the JXA scripts) into `Capacities_Quick_Capture.alfredworkflow`.

### Automated Releases

Releases are fully automated via GitHub Actions. Whenever a pull request is merged into the `main` branch, the release workflow checks if the version number in `info.plist` has been bumped. 

If a new version is detected, the workflow automatically:
1. Packages the workflow files.
2. Creates a new Git tag (e.g. `v1.0.0`).
3. Publishes a new GitHub release with the packaged `.alfredworkflow` file attached as an asset.

Really, that is all there is to it. Go try it out!
