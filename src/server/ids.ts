const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids come from the address bar, so they are checked before they reach a query or a cookie name. */
export const isUuid = (value: string): boolean => UUID.test(value);
