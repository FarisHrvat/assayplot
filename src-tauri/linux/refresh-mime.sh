#!/bin/sh
# Picks up the .asp file type and its icon after install or removal.
update-mime-database /usr/share/mime >/dev/null 2>&1 || true
gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor >/dev/null 2>&1 || true
update-desktop-database -q /usr/share/applications >/dev/null 2>&1 || true
exit 0
