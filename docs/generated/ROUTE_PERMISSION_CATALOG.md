# Generated Route and Permission Catalog

이 파일은 `npm run docs:routes`로 생성한다. 직접 편집하지 않는다.

## Routes

| route id | method | path | auth | permission/policy |
|---|---|---|---|---|
| `assets.generated` | `*` | `/assets/:path*` | public | public |
| `assets.images` | `*` | `/images/:path*` | public | public |
| `assets.favicon` | `*` | `/favicon.ico` | public | public |
| `health.read` | `GET` | `/healthz` | public | public |
| `session.login.form` | `GET` | `/login` | public | public |
| `session.login` | `POST` | `/login` | public | public |
| `session.signup.blocked` | `*` | `/signup` | public | policy:always-404 |
| `home.redirect` | `GET` | `/` | required | authenticated |
| `search.home` | `GET` | `/app` | required | authenticated |
| `floor-plan.read` | `GET` | `/floor-plan` | required | authenticated |
| `qa.read` | `GET` | `/qa` | required | authenticated |
| `search.suggestions` | `GET` | `/api/search-suggestions` | required | authenticated |
| `search.viewer` | `GET` | `/api/viewer/search` | required | authenticated |
| `search.index` | `GET` | `/api/search-index` | required | authenticated |
| `search.click` | `POST` | `/api/search-click` | required | authenticated |
| `session.password.form` | `GET` | `/account/password` | required | authenticated |
| `session.password.change` | `POST` | `/account/password` | required | authenticated |
| `session.logout` | `POST` | `/logout` | required | authenticated |
| `session.logout.fallback` | `*` | `/logout` | required | authenticated |
| `admin.dashboard` | `GET` | `/admin` | required | policy:any-management-permission |
| `admin.settings` | `GET` | `/admin/settings` | required | `can_manage_users` |
| `admin.search-report` | `GET` | `/admin/search-report` | required | `can_view_audit` |
| `admin.audit` | `GET` | `/admin/audit` | required | `can_view_audit` |
| `admin.movements` | `GET` | `/admin/movements` | required | policy:move-or-audit |
| `admin.data-quality` | `GET` | `/admin/data-quality` | required | `can_manage_documents` |
| `admin.user.permissions.form` | `GET` | `/admin/users/:id/permissions` | required | `can_manage_users` |
| `admin.user.permissions` | `POST` | `/admin/users/:id/permissions` | required | `can_manage_users` |
| `admin.user.approve` | `POST` | `/admin/users/:id/approve` | required | `can_manage_users` |
| `admin.user.reject` | `POST` | `/admin/users/:id/reject` | required | `can_manage_users` |
| `admin.user.disable` | `POST` | `/admin/users/:id/disable` | required | `can_manage_users` |
| `admin.user.enable` | `POST` | `/admin/users/:id/enable` | required | `can_manage_users` |
| `documents.duplicate` | `GET` | `/api/documents/duplicate` | required | `can_manage_documents` |
| `documents.list` | `GET` | `/documents` | required | authenticated |
| `documents.create` | `POST` | `/documents` | required | `can_manage_documents` |
| `documents.disposal` | `GET` | `/documents/disposal` | required | `can_manage_disposals` |
| `documents.bulk-dispose` | `POST` | `/documents/bulk-dispose` | required | `can_manage_disposals` |
| `documents.disposal.process` | `POST` | `/documents/disposal/process` | required | `can_manage_disposals` |
| `documents.dispose-filtered` | `POST` | `/documents/dispose-filtered` | required | `can_manage_disposals` |
| `documents.export` | `GET` | `/documents/export.csv` | required | `can_manage_documents` |
| `documents.snapshot.export` | `GET` | `/api/document-snapshot/export` | required | `can_manage_documents` |
| `documents.import.form` | `GET` | `/documents/import` | required | `can_manage_documents` |
| `documents.new` | `GET` | `/documents/new` | required | `can_manage_documents` |
| `documents.details` | `GET` | `/documents/:id` | required | authenticated |
| `documents.edit.form` | `GET` | `/documents/:id/edit` | required | `can_manage_documents` |
| `documents.edit` | `POST` | `/documents/:id/edit` | required | `can_manage_documents` |
| `documents.revise.form` | `GET` | `/documents/:id/revise` | required | `can_manage_documents` |
| `documents.revise` | `POST` | `/documents/:id/revise` | required | `can_manage_documents` |
| `documents.move.form` | `GET` | `/documents/:id/move` | required | `can_move_documents` |
| `documents.move` | `POST` | `/documents/:id/move` | required | `can_move_documents` |
| `documents.dispose` | `POST` | `/documents/:id/dispose` | required | `can_manage_disposals` |
| `documents.restore` | `POST` | `/documents/:id/restore` | required | policy:admin-only |
| `documents.delete-permanent` | `POST` | `/documents/:id/delete-permanent` | required | `can_manage_disposals` |
| `sets.list` | `GET` | `/sets` | required | authenticated |
| `sets.create.form` | `GET` | `/sets/new` | required | `can_manage_sets` |
| `sets.create` | `POST` | `/sets` | required | `can_manage_sets` |
| `sets.details` | `GET` | `/sets/:id` | required | authenticated |
| `sets.export` | `GET` | `/sets/:id/export` | required | authenticated |
| `sets.export.csv` | `GET` | `/sets/:id/export.csv` | required | authenticated |
| `sets.edit.form` | `GET` | `/sets/:id/edit` | required | `can_manage_sets` |
| `sets.edit` | `POST` | `/sets/:id/edit` | required | `can_manage_sets` |
| `sets.delete` | `POST` | `/sets/:id/delete` | required | `can_manage_sets` |
| `sets.add` | `POST` | `/sets/:id/add` | required | `can_manage_sets` |
| `sets.remove` | `POST` | `/sets/:id/remove` | required | `can_manage_sets` |
| `sets.lock` | `POST` | `/sets/:id/lock` | required | `can_manage_sets` |
| `sets.unlock` | `POST` | `/sets/:id/unlock` | required | `can_manage_sets` |
| `racks.list` | `GET` | `/racks` | required | `can_manage_masters` |
| `racks.create` | `POST` | `/racks` | required | `can_manage_masters` |
| `racks.new` | `GET` | `/racks/new` | required | `can_manage_masters` |
| `racks.configure.form` | `GET` | `/racks/configure` | required | `can_manage_masters` |
| `racks.configure` | `POST` | `/racks/configure` | required | `can_manage_masters` |
| `racks.details` | `GET` | `/racks/:id` | required | `can_manage_masters` |
| `racks.edit.form` | `GET` | `/racks/:id/edit` | required | `can_manage_masters` |
| `racks.edit` | `POST` | `/racks/:id/edit` | required | `can_manage_masters` |
| `categories.list` | `GET` | `/categories` | required | `can_manage_masters` |
| `categories.save` | `POST` | `/categories` | required | `can_manage_masters` |
| `categories.edit` | `POST` | `/categories/:id/edit` | required | `can_manage_masters` |
| `categories.delete` | `POST` | `/categories/:id/delete` | required | `can_manage_masters` |
| `tags.list` | `GET` | `/tags` | required | `can_manage_masters` |
| `tags.save` | `POST` | `/tags` | required | `can_manage_masters` |
| `tags.edit` | `POST` | `/tags/:id/edit` | required | `can_manage_masters` |
| `tags.delete` | `POST` | `/tags/:id/delete` | required | `can_manage_masters` |
| `disposal.list` | `GET` | `/disposal-batches` | required | `can_manage_disposals` |
| `disposal.new` | `GET` | `/disposal-batches/new` | required | `can_manage_disposals` |
| `disposal.create` | `POST` | `/disposal-batches` | required | `can_manage_disposals` |
| `disposal.details` | `GET` | `/disposal-batches/:id` | required | `can_manage_disposals` |
| `disposal.edit.form` | `GET` | `/disposal-batches/:id/edit` | required | `can_manage_disposals` |
| `disposal.edit` | `POST` | `/disposal-batches/:id/edit` | required | `can_manage_disposals` |
| `disposal.freeze` | `POST` | `/disposal-batches/:id/freeze` | required | `can_manage_disposals` |
| `disposal.start` | `POST` | `/disposal-batches/:id/start` | required | `can_manage_disposals` |
| `disposal.process` | `POST` | `/disposal-batches/:id/process` | required | `can_manage_disposals` |
| `disposal.cancel` | `POST` | `/disposal-batches/:id/cancel` | required | `can_manage_disposals` |
| `disposal.export` | `GET` | `/disposal-batches/:id/export.csv` | required | `can_manage_disposals` |
| `disposal.item.exclude` | `POST` | `/disposal-batches/:id/items/:itemId/exclude` | required | `can_manage_disposals` |
| `disposal.item.include` | `POST` | `/disposal-batches/:id/items/:itemId/include` | required | `can_manage_disposals` |
| `imports.list` | `GET` | `/document-import-jobs` | required | `can_manage_documents` |
| `imports.create` | `POST` | `/document-import-jobs` | required | `can_manage_documents` |
| `imports.details` | `GET` | `/document-import-jobs/:id` | required | `can_manage_documents` |
| `imports.failures` | `GET` | `/document-import-jobs/:id/failures.csv` | required | `can_manage_documents` |
| `imports.process` | `POST` | `/document-import-jobs/:id/process` | required | `can_manage_documents` |
| `imports.cancel` | `POST` | `/document-import-jobs/:id/cancel` | required | `can_manage_documents` |
| `snapshots.list` | `GET` | `/document-snapshots` | required | `can_manage_documents` |
| `snapshots.create` | `POST` | `/document-snapshots` | required | `can_manage_documents` |
| `snapshots.details` | `GET` | `/document-snapshots/:id` | required | `can_manage_documents` |
| `snapshots.rows` | `POST` | `/document-snapshots/:id/rows` | required | `can_manage_documents` |
| `snapshots.prepare` | `POST` | `/document-snapshots/:id/prepare` | required | `can_manage_documents` |
| `snapshots.apply` | `POST` | `/document-snapshots/:id/apply` | required | policy:allOf:can_manage_documents+can_apply_document_snapshots |
| `snapshots.cancel` | `POST` | `/document-snapshots/:id/cancel` | required | `can_manage_documents` |

## Permission matrix

| permission/policy | route ids |
|---|---|
| `can_manage_disposals` | `documents.disposal`, `documents.bulk-dispose`, `documents.disposal.process`, `documents.dispose-filtered`, `documents.dispose`, `documents.delete-permanent`, `disposal.list`, `disposal.new`, `disposal.create`, `disposal.details`, `disposal.edit.form`, `disposal.edit`, `disposal.freeze`, `disposal.start`, `disposal.process`, `disposal.cancel`, `disposal.export`, `disposal.item.exclude`, `disposal.item.include` |
| `can_manage_documents` | `admin.data-quality`, `documents.duplicate`, `documents.create`, `documents.export`, `documents.snapshot.export`, `documents.import.form`, `documents.new`, `documents.edit.form`, `documents.edit`, `documents.revise.form`, `documents.revise`, `imports.list`, `imports.create`, `imports.details`, `imports.failures`, `imports.process`, `imports.cancel`, `snapshots.list`, `snapshots.create`, `snapshots.details`, `snapshots.rows`, `snapshots.prepare`, `snapshots.cancel` |
| `can_manage_masters` | `racks.list`, `racks.create`, `racks.new`, `racks.configure.form`, `racks.configure`, `racks.details`, `racks.edit.form`, `racks.edit`, `categories.list`, `categories.save`, `categories.edit`, `categories.delete`, `tags.list`, `tags.save`, `tags.edit`, `tags.delete` |
| `can_manage_sets` | `sets.create.form`, `sets.create`, `sets.edit.form`, `sets.edit`, `sets.delete`, `sets.add`, `sets.remove`, `sets.lock`, `sets.unlock` |
| `can_manage_users` | `admin.settings`, `admin.user.permissions.form`, `admin.user.permissions`, `admin.user.approve`, `admin.user.reject`, `admin.user.disable`, `admin.user.enable` |
| `can_move_documents` | `documents.move.form`, `documents.move` |
| `can_view_audit` | `admin.search-report`, `admin.audit` |
| authenticated | `home.redirect`, `search.home`, `floor-plan.read`, `qa.read`, `search.suggestions`, `search.viewer`, `search.index`, `search.click`, `session.password.form`, `session.password.change`, `session.logout`, `session.logout.fallback`, `documents.list`, `documents.details`, `sets.list`, `sets.details`, `sets.export`, `sets.export.csv` |
| policy:admin-only | `documents.restore` |
| policy:allOf:can_manage_documents+can_apply_document_snapshots | `snapshots.apply` |
| policy:always-404 | `session.signup.blocked` |
| policy:any-management-permission | `admin.dashboard` |
| policy:move-or-audit | `admin.movements` |
| public | `assets.generated`, `assets.images`, `assets.favicon`, `health.read`, `session.login.form`, `session.login` |
