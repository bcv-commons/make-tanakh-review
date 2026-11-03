// Shared by the stores: a write that names a version (or a branch head) that has moved on since it was read.
export class StaleError extends Error {
  constructor(msg) { super(msg); this.name = "StaleError"; }
}
