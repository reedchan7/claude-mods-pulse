MARKETPLACE := claude-mods-pulse
MODS := $(wildcard mods/*)
PLUGINS := Pulse
TSC := npx --yes -p typescript@5.6.3 tsc

.PHONY: help check validate test typecheck install uninstall status

help:
	@echo "make check      validate, test and type-check every mod"
	@echo "make install    add this folder as the '$(MARKETPLACE)' marketplace and install its mods for your user"
	@echo "make uninstall  remove the mods and the marketplace"
	@echo "make status     show what Claude Code has installed from here"

check: validate test typecheck

validate:
	claude plugin validate .
	@for mod in $(MODS); do claude plugin validate $$mod || exit 1; done

test:
	@for mod in $(MODS); do claude plugin test $$mod || exit 1; done

# The engine lays each mod's types in .claude-plugin/types when it loads the mod from a watched
# folder (`claude --plugin-dir mods/<mod>` in an interactive session), so a fresh clone needs one load.
typecheck:
	@for mod in $(MODS); do \
		if [ ! -f $$mod/.claude-plugin/types/tsconfig.json ]; then \
			echo "$$mod: no types yet; run 'claude --plugin-dir $$mod' once to lay them"; exit 1; \
		fi; \
		$(TSC) -p $$mod || exit 1; \
	done

# A folder marketplace whose entries are relative paths is read in place: edits reach a session
# after /reload-plugins, with no reinstall.
install:
	claude plugin marketplace add $(CURDIR)
	@for plugin in $(PLUGINS); do claude plugin install $$plugin@$(MARKETPLACE) --scope user || exit 1; done

uninstall:
	@for plugin in $(PLUGINS); do claude plugin uninstall $$plugin@$(MARKETPLACE) || true; done
	claude plugin marketplace remove $(MARKETPLACE)

status:
	@claude plugin list | awk '/@$(MARKETPLACE)/ { n = 4 } n && n--'
