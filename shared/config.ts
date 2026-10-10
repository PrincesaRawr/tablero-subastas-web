/**
 * Constantes configurables del juego.
 * Las marcadas con [Dn] corresponden a las decisiones ⚠ del documento PROMPT.md
 * y están explicadas en la sección "Decisiones y supuestos" del README.
 */

/** [D1] Colores de ficha, en el orden en que se muestran. */
export const COLORS = ['rosa', 'azul', 'naranja', 'verde', 'morado'] as const;
export type Color = (typeof COLORS)[number];

/** Nombre visible de cada color (con mayúscula, para el registro "Rosa A3"). */
export const COLOR_LABEL: Record<Color, string> = {
  rosa: 'Rosa',
  azul: 'Azul',
  naranja: 'Naranja',
  verde: 'Verde',
  morado: 'Morado',
};

/** Símbolo accesible de cada color (daltonismo). */
export const COLOR_SYMBOL: Record<Color, string> = {
  rosa: '♥',
  azul: '◆',
  naranja: '●',
  verde: '▲',
  morado: '✦',
};

/** Tablero de 8×8. Columnas A–H, filas 1–8. */
export const BOARD_SIZE = 8;
export const COLUMN_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

export const STARTING_COINS = 40;
/** Máximo de monedas que el anfitrión puede asignar a un jugador. */
export const MAX_COINS = 999;
export const TOTAL_ROUNDS = 10;
export const TOKENS_PER_AUCTION = 5;
/**
 * Cada subasta tiene su propio saco con esta cantidad de fichas de cada color.
 * Las fichas que salen no vuelven (aunque se descarten). 15 × 5 colores = 75 por saco; en 10 rondas salen 50.
 */
export const BAG_PER_COLOR = 15;

/** [D2] Longitud de la combinación secreta (colores distintos, sin inversas repetidas). */
export const COMBO_LENGTH = 3;

/** [D3] Puja mínima en una subasta en la que se participa. */
export const MIN_BID = 1;

/** [D11] Jugadores por sala. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;

/**
 * [D4, D9 — cambiados a petición] Nunca hay desempate al azar: todo empate se negocia.
 *  - Si varias personas empatan en la subasta que da fichas, se reparten sus 5 fichas:
 *    cada una elige 5 / n (redondeando hacia abajo), sin repetir las de las demás.
 *  - Si A y B acaban con la misma puja, negocian todos los ganadores de las dos subastas:
 *    quien ganó su subasta en solitario elige NEGOTIATION_PICK de sus fichas; los empatados, 5 / n.
 * Cada uno coloca solo sus fichas y hace falta que TODOS estén de acuerdo.
 */
export const NEGOTIATION_PICK = 3;
export const NEGOTIATION_TIME_LIMIT_S = 120;

/** Temporizadores opcionales del anfitrión (0 = sin límite). */
export const DEFAULT_AUCTION_TIMER_S = 0;
export const DEFAULT_PLACEMENT_TIMER_S = 0;
export const MAX_TIMER_S = 600;
/** Cuando todos los jugadores han enviado su puja, la subasta se cierra sola tras estos segundos sin cambios (0 = nunca). */
export const AUTO_CLOSE_AFTER_ALL_BIDS_S = 5;
/** Modo automático del anfitrión: segundos de espera antes de cada paso. */
export const AUTO_DEAL_DELAY_S = 1; // sacar fichas al empezar la ronda
export const AUTO_OPEN_DELAY_S = 4; // abrir la subasta (tiempo para ver las fichas)
export const AUTO_NEXT_DELAY_S = 3; // pasar de ronda (tiempo para ver el resultado)

/** Código de sala: longitud y alfabeto (sin letras confusas como I/O). */
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export const MAX_NAME_LENGTH = 20;

/** Chat de la partida (general y privado). Se borra al terminar la partida. */
export const CHAT_MAX_LENGTH = 300;
export const CHAT_MAX_MESSAGES = 500;
/** Tiempo mínimo entre dos mensajes de la misma persona (antispam). */
export const CHAT_MIN_INTERVAL_MS = 400;

/** Salas sin nadie conectado se borran pasado este tiempo. */
export const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
