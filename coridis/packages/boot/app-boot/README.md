# @coridis/app-boot

Profile/bundle composition and Cordis boot helpers.

**Status: implemented.** Behavior is covered by specs in `tests/` under this package.

## Role

Boot library. It reads `profile.yml`, resolves bundle packages and their
`coridis.bundle.patch` files, folds bundle patches, patch files, and inline layers into one row
list, resolves each plugin from its contributing bundle, and mounts the tree on a fresh
`Context`. The composer runs once; it has no file watcher or hot reload.

## See also

- [architecture](../../../docs/architecture.md)
- [capability seams](../../../docs/capability-seams.md)
