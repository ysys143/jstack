# Optional compatibility functions. Source explicitly after installing the jstack CLI.
# These functions do not load personal shell code or mutate files at source time.
disks() { command jst disk status && command jst disk scan home; }
dh() { command jst disk scan home "$@"; }
dgh() { command jst disk scan github "$@"; }
dicl() { command jst disk scan icloud "$@"; }
dcol() { command jst disk scan colima "$@"; }
dol() { command jst disk scan ollama "$@"; }
das() { command jst disk scan lib_appsupport "$@"; }
dlc() { command jst disk scan lib_caches "$@"; }
dct() { command jst disk scan cache "$@"; }
dl() { command jst disk scan library "$@"; }
dd() { command jst disk scan documents "$@"; }
dm() { command jst disk scan movies "$@"; }
dss() { command jst disk scan pictures "$@"; }
ddt() { local category; for category in npm bun nvm pyenv cursor gradle ghcup; do command jst disk scan "$category" "$@"; done; }
dml() { local category; for category in hf_cache uv_cache torch keras tensorflow pip; do command jst disk scan "$category" "$@"; done; }
dcache() { print 'Review candidates with the disk-manager skill; blanket deletion is not supported.'; command jst disk scan cache --fresh; }
dnpm() { print 'Review npm cache cleanup with the disk-manager skill.'; command jst disk scan npm --fresh; }
dref() { command jst disk scan home --fresh "$@"; }
dsnap() { command jst disk snapshot "$@"; }
ddiff() { command jst disk diff --hours "${1:-24}"; }
dhist() { command jst disk history "${1:-all}" --days "${2:-14}"; }
