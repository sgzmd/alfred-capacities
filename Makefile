.PHONY: all build test coverage e2e check package clean

NODE_ENV_FLAG = $(shell [ -f .env ] && echo "--env-file=.env")
WORKFLOW_NAME = Capacities_Quick_Capture.alfredworkflow

all: test

build:
	node scripts/build.mjs

test:
	node $(NODE_ENV_FLAG) --experimental-strip-types --test 'test/**/*.test.ts'

coverage:
	node $(NODE_ENV_FLAG) --experimental-strip-types --test --experimental-test-coverage 'test/**/*.test.ts'

e2e:
	node $(NODE_ENV_FLAG) --experimental-strip-types scripts/e2e.ts

check:
	npm run typecheck
	plutil -lint info.plist

package: check test build
	@rm -f $(WORKFLOW_NAME)
	@cd dist && zip -q -r ../$(WORKFLOW_NAME) send_to_daily_note.js setup.js log.js
	@zip -q -u $(WORKFLOW_NAME) info.plist icon.png
	@echo "Successfully packaged $(WORKFLOW_NAME)"

clean:
	rm -rf dist $(WORKFLOW_NAME)
