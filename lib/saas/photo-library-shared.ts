// Costanti della Libreria foto usate anche nelle pagine (niente codice del server qui).

/** Foto al massimo nella libreria di uno spazio. */
export const LIBRARY_MAX = 200
/** Foto al massimo per ogni richiesta di caricamento (il browser ne chiede a gruppi). */
export const LIBRARY_BATCH = 25
/** Peso massimo di una foto dopo la riduzione nel browser (limite dell'archivio: 10 MB). */
export const LIBRARY_MAX_MB = 10
/** Lato lungo delle foto ridotte nel browser prima del caricamento. */
export const LIBRARY_MAX_SIDE = 2048
/** Instagram: da 2 a 10 foto per carosello. */
export const CAROUSEL_MIN = 2
export const CAROUSEL_MAX = 10
export const AUTOPILOT_MAX_TIMES = 3
export const AUTOPILOT_MAX_TOPIC = 1000
