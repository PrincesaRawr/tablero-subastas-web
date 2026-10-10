# 👑 Tablero de Subastas

Juego web multijugador en tiempo real que sustituye a los comandos del bot de Discord. Salas con código, subastas a ciegas, colocación por clic, negociación en caso de empate y recuento automático de apariciones. Toda la interfaz está en español y se puede jugar desde el móvil.

## Ejecutar en local

Requisitos: Node.js 18 o superior.

```bash
npm install
npm run dev        # servidor en :3001 + web en http://localhost:5173
```

Abre `http://localhost:5173` en varias pestañas (o en el móvil, con la IP de tu PC) para probar con varios jugadores.

Producción (un único proceso sirve la web y los sockets):

```bash
npm run build
npm start          # http://localhost:3001  (puerto configurable con PORT)
```

Tests (motor, máquina de estados e integración con 3 clientes Socket.IO):

```bash
npm test
```

## Desplegar

El estado vive **en memoria**, así que hay que usar **una sola instancia**. Si el servidor se reinicia, las partidas en curso se pierden.

### Render
1. Sube el repo a GitHub.
2. En Render: **New → Blueprint** y elige el repo (usa `render.yaml`). También vale **New → Web Service** con:
   - Build command: `npm ci --include=dev && npm run build`
   - Start command: `npm start`
   - Health check: `/health`
3. Render asigna `PORT` automáticamente. WebSockets funcionan sin configuración extra.

> En el plan gratuito el servicio "se duerme" sin tráfico: la primera carga tarda unos segundos y las salas abiertas se pierden al dormirse.

### Railway
**New Project → Deploy from GitHub repo**. Railway detecta el `Dockerfile`, o puedes usar Nixpacks con los mismos comandos de build y start de arriba.

### Docker
```bash
docker build -t tablero-subastas .
docker run -p 3001:3001 tablero-subastas
```

## Estructura

```
shared/     Motor del juego: funciones puras, sin red (lo usan servidor y cliente)
  config.ts   ← TODAS las constantes configurables (D1–D12)
  engine.ts   combinaciones, apariciones, pujas, resolución, colocación, resultados
  game.ts     máquina de estados de la partida (reductor puro)
  view.ts     vista filtrada que recibe cada jugador
  protocol.ts mensajes Socket.IO
server/     Express + Socket.IO, salas en memoria, temporizadores
client/     React + Vite
tests/      Vitest: motor, partida e integración
```

**Arquitectura.** El servidor es autoritativo: el cliente solo envía intenciones (`game:action`) y el servidor las pasa por `gameReducer`, que valida fase, jugador, puja, fichas y casillas. Después envía a **cada** jugador una vista construida con `buildView`, que nunca incluye combinaciones ajenas (hasta el final) ni pujas ajenas (solo las de los ganadores ya resueltos). El test de integración recorre todos los mensajes recibidos por cada cliente durante una partida entera y comprueba que no hay fugas.

**Reconexión.** Al crear o unirse a una sala, el servidor da un token que se guarda en `localStorage`. Si recargas la página o se corta la conexión, el cliente lo reenvía y recuperas tu sitio, tu combinación, tus monedas y tu puja pendiente.

### Flujo de la ronda

`LOBBY → FICHAS → PUJAS_ABIERTAS → RESOLUCION → [NEGOCIACION] → COLOCACION → RONDA_CERRADA → … → FIN`

| Fase | Quién actúa |
|---|---|
| FICHAS | El anfitrión pulsa *Repartir fichas* (se ven las 5+5) y luego *Abrir subasta*. |
| PUJAS_ABIERTAS | Todos pujan y pueden cambiar la puja. Se ve quién ha pujado, pero no cuánto. El anfitrión pulsa *Cerrar subasta* o salta el temporizador. |
| RESOLUCION | Es instantánea, salvo cuando un jugador gana A y B con la misma puja (D5): entonces elige con qué fichas se queda. |
| NEGOCIACION | Solo hay negociación si los dos ganadores empatan (ver abajo). |
| COLOCACION | El ganador toca una ficha y luego una casilla libre. Puede deshacer antes de confirmar. El anfitrión puede forzar una colocación aleatoria. |
| RONDA_CERRADA | El anfitrión pasa a la siguiente ronda (o a *Ver resultados* tras la 10). |

## Pantallas

| | |
|---|---|
| **Inicio**: nombre, *Crear sala* (con "Yo también juego") o *Unirse con código*. ![](docs/capturas/inicio.png) | **Lobby**: código grande para copiar, lista de jugadores, expulsar, temporizadores opcionales y *Empezar partida*. ![](docs/capturas/lobby.png) |
| **Pujas (móvil)**: fichas de A y B, campos con botones +/−, monedas restantes y quién ha pujado. ![](docs/capturas/pujas-movil.png) | **Colocación**: revelación de ganadores, bandeja de fichas y vista previa en el tablero. ![](docs/capturas/colocacion.png) |
| **Negociación (móvil)**: elegir 3 fichas, propuesta en el tablero (en dorado), aceptar, rechazar y contraproponer, o declarar sin acuerdo. ![](docs/capturas/negociacion-movil.png) | **Final**: ranking con las combinaciones reveladas. Al tocar un jugador se resaltan sus apariciones. ![](docs/capturas/final.png) |

Siempre visibles: tu combinación (con botón **Ocultar/Mostrar** por si compartes pantalla), **Resaltar mis apariciones** con un contador en vivo ("ahora mismo tienes 2" y, mientras colocas, cuántas tendrías con esa colocación), monedas, ronda n/10, jugadores con sus monedas e historial en notación `Rosa A3, Azul C7…` para quien siga la partida por voz. El botón **📖 Reglas** abre el resumen con el ejemplo de 15 contra 17.

**Accesibilidad.** Cada color lleva su símbolo (rosa ♥, azul ◆, naranja ●, verde ▲, morado ✦). Las casillas tienen etiqueta ("C4: Azul"), el foco se ve al navegar con teclado y las animaciones se desactivan con `prefers-reduced-motion`.

## Decisiones y supuestos (D1–D12)

Todo está en `shared/config.ts` para que lo puedas cambiar.

| # | Situación | Implementado |
|---|---|---|
| D1 | Colores | `COLORS`: rosa, azul, naranja, verde, morado. |
| D2 | Combinaciones | 3 colores distintos (`COMBO_LENGTH`), únicas y sin inversas entre jugadores. Caben hasta 30 jugadores (`MAX_DISTINCT_COMBOS`). |
| D3 | Puja válida | Entero ≥ `MIN_BID` (1) en cada subasta en la que participas (0 = no participas). A + B ≤ tus monedas. Con 0 monedas no se puede pujar. |
| D4 | Empate dentro de una subasta | **Cambiado a petición: nunca hay desempate al azar.** Todos los empatados son ganadores y pierden su puja. Si esa subasta es la que da fichas, se reparten sus 5 negociando: cada uno elige `floor(5 / n)` (2 si son dos, 1 si son 3–5), sin repetir las de los demás. |
| D5 | El mismo jugador gana A y B | Recibe las fichas de la subasta donde pujó menos y pierde ambas pujas. Si pujó lo mismo en las dos, elige él (fase RESOLUCION). |
| D6 | Solo un ganador | Recibe sus fichas y pierde su puja. |
| D7 | Nadie puja | La ronda pasa sin efecto y las fichas se descartan. |
| D8 | Casillas | Solo casillas vacías; nunca se sustituyen fichas. |
| D9 | Negociación | **Cambiado a petición:** negocian todos los ganadores implicados. Si A y B acaban con la misma puja, quien ganó su subasta en solitario elige `NEGOTIATION_PICK` (3) de sus fichas y los empatados dentro de una subasta `floor(5 / n)` cada uno (ej.: 2 en la A y 1 en la B → 2 + 2 de la A y 3 de la B). Cada uno coloca **solo las suyas** y los demás las ven en tiempo real (en dorado). Cuando **todos** pulsan «Estoy de acuerdo» se aplican; cualquier cambio anula los vistos buenos. «Sin acuerdo» o fin del tiempo (`NEGOTIATION_TIME_LIMIT_S` = 120 s) → ronda nula y todos pierden su puja. Única excepción: si una misma persona gana A y B en solitario con la misma puja, elige ella (D5). |
| D10 | Empate al final | Ganan todos los empatados. |
| D11 | Jugadores | `MIN_PLAYERS` = 2, `MAX_PLAYERS` = 12. |
| D12 | Revelación | Solo se muestran las pujas de los dos ganadores (y con quién empataron en D4). Las demás nunca salen del servidor. |

### Otros huecos que he cerrado (la opción más simple)

- **Coordenadas**: columnas A–H y filas 1–8, como en la imagen y en el PROMPT. Las reglas originales de Discord decían lo contrario (filas con letras). Lo he hecho así porque el PROMPT pide "como en la imagen".
- **Qué pierde un ganador**: solo la puja de la subasta que ganó. Si Ana gana A con 15 y también pujó 5 en B (que gana otra persona), recupera esos 5. Excepción: D5.
- **Monedas durante la subasta**: no se descuentan al pujar, solo se reservan. Se cobran al cerrar la subasta.
- **Fichas de cada subasta**: 5 colores al azar con repetición (puede salir 3 veces rosa).
- **Temporizadores** (`DEFAULT_AUCTION_TIMER_S`, `DEFAULT_PLACEMENT_TIMER_S`, 0 = sin límite; el anfitrión los cambia en el lobby, hasta `MAX_TIMER_S`):
  - Si se agota el de pujas, la subasta se cierra sola.
  - Si se agota el de colocación, las fichas se colocan al azar.
  - Sin límite, el anfitrión puede forzar la colocación aleatoria cuando quiera (pide confirmación).
- **Negociación**: cambiar las fichas elegidas borra tu colocación provisional. Los demás jugadores ven quién negocia, si ya han elegido y quién está de acuerdo, pero no qué fichas ni dónde hasta que se aplican.
- **Entrar y salir**:
  - Solo se puede entrar en la sala desde el lobby (no hay espectadores) y los nombres no se pueden repetir dentro de una sala.
  - Solo se expulsa desde el lobby.
  - Quien se desconecta en mitad de la partida conserva su sitio. Si le tocaba colocar, el anfitrión puede forzar la colocación aleatoria.
  - El anfitrión no sale de la sala: la cierra.
- **"Nueva partida con los mismos jugadores"**: empieza ya una partida nueva (tablero vacío, 40 monedas, combinaciones nuevas) con quienes estaban jugando.
- **Salas abandonadas**: se borran tras 30 minutos sin nadie conectado (`EMPTY_ROOM_TTL_MS`).
- **Código de sala**: 4 letras sin I ni O para evitar confusiones (`ROOM_CODE_LENGTH`, `ROOM_CODE_ALPHABET`).

### Herramientas del anfitrión (añadidas después)

- **Ver pujas de todos**: con la subasta abierta, el anfitrión puede ver las pujas actuales. Cada vez que mira, queda en el historial ("👀 Ana ha mirado las pujas") y a los demás les sale un aviso. Las pujas solo llegan al anfitrión que las pide, nunca en la vista del resto.
- **Enviar sin pujar**: enviar 0 y 0 cuenta como "enviado" (✓ en la lista de jugadores) sin participar en ninguna subasta. Se puede cambiar mientras la subasta siga abierta. Sustituye al antiguo botón "Retirar puja".
- **Añadir o quitar monedas**: botón **±** junto a cada jugador (0 a `MAX_COINS`). Queda en el historial y se avisa a todos. Con la subasta abierta no se puede dejar a nadie con menos monedas de las que ya ha pujado.
- **Sacos de fichas** (añadido a petición): cada subasta tiene su saco con `BAG_PER_COLOR` (15) fichas de cada color, 75 por saco; cada ronda se sacan 5 de cada saco sin devolverlas (aunque se descarten). En 10 rondas salen 50 de cada saco y sobran 25. Con el botón «🎒 Ver sacos» (oculto por defecto) cada jugador puede ver cuántas quedan de cada color.
- **Chat de la partida**: botón 💬 flotante con pestaña "General" (todos) y una privada por persona (solo las dos personas; el servidor nunca envía un privado a nadie más). El anfitrión puede revisar todos los chats (también los privados) desde "⚙️ Controles del anfitrión → Ver todos los chats": cada vez que lo hace queda en el historial ("👁 Ana ha mirado todos los chats") y se avisa a todos; los mensajes ajenos solo le llegan en la respuesta a esa petición, nunca de fondo. El texto de los privados avisa de que el anfitrión puede revisarlos. Solo existe durante la partida y se borra al terminar (FIN, terminar ahora o cerrar sala). Límite de `CHAT_MAX_LENGTH` caracteres y antispam `CHAT_MIN_INTERVAL_MS`.
- **Monedas iniciales**: el anfitrión las elige en el lobby (botones 20–100 u otra cantidad, de 1 a `MAX_COINS`). Por defecto `STARTING_COINS` = 40. Solo se pueden cambiar antes de empezar o al terminar la partida.
- **Modo automático** (interruptor del anfitrión, en el lobby y en "Controles del anfitrión"): saca las fichas (`AUTO_DEAL_DELAY_S` = 2 s), abre la subasta (`AUTO_OPEN_DELAY_S` = 5 s) y pasa de ronda (`AUTO_NEXT_DELAY_S` = 6 s) solo, con un aviso con cuenta atrás para todos. El anfitrión puede adelantarse pulsando los botones.
- **Cierre automático de la subasta**: cuando todos los jugadores han enviado su puja (también "sin pujar"), se cierra sola a los `AUTO_CLOSE_AFTER_ALL_BIDS_S` (5) segundos si nadie la cambia; cada cambio reinicia la cuenta. El anfitrión puede seguir cerrándola a mano.
- **Terminar partida ahora** y **Cerrar sala**: en "⚙️ Controles del anfitrión" durante la partida. Terminar cuenta las apariciones con el tablero tal y como está.
