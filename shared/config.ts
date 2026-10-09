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

/** [D2] Longitud de la combinación secreta (colores distintos, sin inversas repetidas). */
export const COMBO_LENGTH = 3;

/** [D3] Puja mínima en una subasta en la que se participa. */
export const MIN_BID = 1;

/** [D11] Jugadores por sala. */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;

/**
 * [D4, cambiado a petición] Si EXACTAMENTE dos personas empatan con la puja más alta de una misma subasta
 * y esa subasta es la que da fichas, cada una elige SHARED_TIE_PICK de sus 5 fichas y las coloca ella misma.
 * Con 3 o más empatadas (o en false) se desempata al azar.
 */
export const SAME_AUCTION_TIE_NEGOTIATES = true;
/** En ese empate, cada persona elige estas fichas (sin repetir las del otro) y las coloca ella misma. */
export const SHARED_TIE_PICK = 2;

/** [D9] Fichas que elige cada negociador y tiempo límite de la negociación. */
export const NEGOTIATION_PICK = 3;
export const NEGOTIATION_TIME_LIMIT_S = 120;

/** Temporizadores opcionales del anfitrión (0 = sin límite). */
export const DEFAULT_AUCTION_TIMER_S = 0;
export const DEFAULT_PLACEMENT_TIMER_S = 0;
export const MAX_TIMER_S = 600;

/** Código de sala: longitud y alfabeto (sin letras confusas como I/O). */
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export const MAX_NAME_LENGTH = 20;

/** Salas sin nadie conectado se borran pasado este tiempo. */
export const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
