SHELL := /bin/bash

JS_FILES = $(shell echo {extension,convenience,intellihide,panelVisibilityManager,touchGesture,touchState,prefs,desktopIconsIntegration}.js)
UI_FILES = $(shell echo Settings.ui)

LOCALES_PO = $(wildcard locale/*/*/*.po)
LOCALES_MO = $(patsubst %.po,%.mo,$(LOCALES_PO))

.PHONY: distclean clean all all-po test test-native

all: hidetopbar.zip

schemas/gschemas.compiled: $(wildcard schemas/*.gschema.xml)
	glib-compile-schemas --strict ./schemas/

hidetopbar.zip: $(JS_FILES) $(UI_FILES) metadata.json schemas/gschemas.compiled $(LOCALES_MO)
	zip hidetopbar.zip -r COPYING.txt $(JS_FILES) metadata.json $(LOCALES_MO) schemas Settings.ui

clean:
	rm -rf hidetopbar.zip schemas/gschemas.compiled ${LOCALES_MO}

distclean: clean
	rm -rf locale/hidetopbar.pot-stamp

%.mo: %.po locale/hidetopbar.pot locale/hidetopbar.pot-stamp
	msgfmt -c -o $@ $<

%.po: locale/hidetopbar.pot locale/hidetopbar.pot-stamp
	@echo "Updating $@"
	@msgmerge --previous --update $@ $<

all-po: $(LOCALES_PO)

locale/hidetopbar.pot locale/hidetopbar.pot-stamp : $(UI_FILES)
	xgettext --copyright-holder="Thomas Vogt" \
			 --package-name="Hide Top Bar" \
			 --output=locale/hidetopbar.pot \
			 $(JS_FILES) $(UI_FILES)
	sed -i '1s/.*/# <LANGUAGE> translation for the Hide Top Bar extension./' locale/hidetopbar.pot
	sed -i "2s/.*/# Copyright (C) $$(date +%Y) Thomas Vogt/" locale/hidetopbar.pot
	sed -i '17s/CHARSET/UTF-8/' locale/hidetopbar.pot
	touch locale/hidetopbar.pot-stamp

test:
	node --experimental-vm-modules --test tests/*.test.mjs

test-native:
	python3 tests/native/run.py
