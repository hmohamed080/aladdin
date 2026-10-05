# Installer settings preview

Preview only: local form and toggle state; no authentication, database, or account mutations.

The page uses the shared installer theme (`src/styles/installer-theme.css`) and does not define any colours
of its own. Its flatter look (sand hairlines, navy ink and accent, flat navy surfaces in dark) is the shared
theme's `flat` variant, selected with `data-installer-theme="flat"` on the page root. The four approved
colours are `#071A2D`, `#D8C7A6`, `#B96F52`, `#F2E9D8`, declared once in that file.

`settings.module.css` keeps only Settings-specific behaviour: the switch control, the header treatment and
two utility-class remaps.
