/**
 * User storage subpackage.
 *
 * Ports ``quill.persistence.user.__init__``. Holds the row model for the
 * ``users`` table. The concrete repository implementation lives in the app
 * layer (it converts between the row and the auth module's ``User`` class),
 * keeping the harness package free of any dependency on app code.
 */

export { USERS_TABLE, USERS_DDL } from "./model.js";
export type { UserRow } from "./model.js";
