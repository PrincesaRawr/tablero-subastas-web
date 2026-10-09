# Proyecto: "Tablero de Subastas" — juego web multijugador

Quiero que construyas una aplicación web para jugar al **Tablero de Subastas**, un juego de estrategia para varios jugadores que hasta ahora se juega en un servidor de Discord con comandos de bot. La web lo sustituye: salas con código, partida en tiempo real, interfaz en **español**.

Lee primero estos archivos de la carpeta del proyecto:

- `reglas_originales.txt`: las reglas tal y como las publiqué en Discord. Es la fuente de verdad. Ignora los emojis/códigos de Discord (`:zanimatedarrowpink:`, etc.).
- `referencias/tablero_vacio.png`: el aspecto visual del tablero y de las fichas (gatitos con corona dentro de medallones de colores, tema morado/princesas).
- `referencias/ejemplo_tablero.png`: un tablero a mitad de partida con las apariciones de la combinación rosa → azul → naranja marcadas con contornos rosas. Quiero poder reproducir ese resaltado.

Este documento resume las reglas, fija decisiones que las reglas originales dejaban abiertas y describe lo que quiero construir. **No me hagas preguntas sobre lo marcado con ⚠: usa el valor por defecto indicado, déjalo como constante configurable y lístalo al final en el README** para que yo lo revise.

---

## 1. Reglas del juego (resumen)

**Preparación**
- Tablero compartido de **8×8**. Columnas = letras **A–H** (arriba), filas = números **1–8** (a la izquierda), como en la imagen. Una casilla se nombra `A3` = columna A, fila 3.
- **5 colores de ficha** (los de la imagen): rosa, azul, naranja, verde, morado.
- Cada jugador recibe **en secreto** una combinación de **3 colores en orden** (ej.: naranja → verde → azul). Todas las combinaciones son distintas.
- Cada jugador empieza con **40 monedas**.
- La partida dura **10 rondas**.

**Objetivo:** al terminar la ronda 10, tener el mayor número de apariciones de tu combinación en el tablero. Cuenta en horizontal, vertical y diagonal, **en cualquiera de los dos sentidos** (se puede leer al revés), respetando el orden de colores.

**Cada ronda**
1. Hay dos subastas simultáneas, **A** y **B**, cada una con **5 fichas de colores aleatorios** (públicas).
2. Cada jugador puede no participar, pujar solo en A, solo en B o en ambas. Las pujas son **secretas** (subasta a ciegas) y se pueden **cambiar mientras la subasta esté abierta**.
3. Al cerrar, gana cada subasta quien más pujó en ella → hay hasta dos "ganadores".
4. **El giro clave:** de los dos ganadores, **solo recibe las fichas el que pujó MENOS**. Ese coloca sus 5 fichas donde quiera en casillas libres. Las fichas de la otra subasta **se eliminan del juego**.
   - Ejemplo: gana A con 15 y gana B con 17 → se lleva las fichas el ganador de A.
5. **Empate** (los dos ganadores pujaron lo mismo): **negociación**. Cada uno elige 3 de sus 5 fichas y entre los dos acuerdan dónde colocar esas 6 fichas. Si no hay acuerdo, la ronda es **nula**: nadie coloca y ambos pierden lo pujado.
6. **Monedas:** los dos ganadores de subasta (A y B) **pierden las monedas que pujaron**, hayan recibido fichas o no. El resto **recupera todo** lo que pujó esa ronda.

**Fin:** tras la ronda 10 se cuentan las apariciones de la combinación de cada jugador. Gana quien más tenga.

---

## 2. Decisiones que las reglas dejaban abiertas ⚠

Implementa todo esto como constantes en un único archivo de configuración (`config.ts` o similar) y documéntalas en el README.

| # | Situación | Valor por defecto |
|---|-----------|-------------------|
| D1 | Colores de ficha | rosa, azul, naranja, verde, morado. Los ejemplos del texto original con "amarillo/rojo" son solo ilustrativos. |
| D2 | Combinaciones | 3 colores **distintos**, asignados al azar por el servidor, únicas por jugador y **sin que dos jugadores tengan combinaciones inversas entre sí** (porque se puede leer al revés y puntuarían igual). |
| D3 | Puja válida | Entero **≥ 1**. La **suma de las pujas en A y B** no puede superar las monedas actuales del jugador. Con 0 monedas no se puede pujar. |
| D4 | Empate por la puja más alta **dentro de una misma subasta** (dos jugadores pujan lo mismo y es el máximo) | Desempate **aleatorio** hecho por el servidor, anunciado a todos. |
| D5 | Un mismo jugador gana A **y** B | Recibe las fichas de la subasta donde pujó **menos** (si pujó igual, elige él) y pierde las monedas de **ambas** pujas. |
| D6 | Solo hay un ganador (nadie pujó en la otra subasta) | Ese ganador recibe sus fichas y pierde su puja. |
| D7 | Nadie pujó en ninguna subasta | La ronda pasa sin efecto; las fichas se descartan. |
| D8 | Casillas | Solo se colocan fichas en **casillas vacías**. Nunca se sustituyen fichas. |
| D9 | Negociación | Ver sección 4.4. Límite de tiempo por defecto: **120 s**; si expira, ronda nula. |
| D10 | Fin de partida con empate | Ganan **todos** los empatados. |
| D11 | Jugadores | De **2 a 12** por sala. |
| D12 | Pujas en la revelación | Se muestran públicamente **solo las pujas de los dos ganadores** (y el desempate si lo hubo). Las pujas del resto permanecen privadas. |

---

## 3. Arquitectura recomendada

Puedes cambiarla si lo justificas brevemente en el README, pero quiero algo **simple de ejecutar y de desplegar**.

- **TypeScript** en todo el proyecto.
- **Servidor:** Node.js + Express + **Socket.IO**. Estado de las salas **en memoria** (sin base de datos, sin cuentas de usuario).
- **Cliente:** React + Vite.
- **Motor del juego** como módulo de **funciones puras y sin dependencias de red**, compartido por cliente y servidor (monorepo simple: `/server`, `/client`, `/shared`). El servidor es **autoritativo**: el cliente nunca decide resultados.
- Un único `npm install && npm run dev` para desarrollo y `npm run build && npm start` para producción (un solo proceso que sirve la web y los sockets). Incluye un `Dockerfile` pequeño y instrucciones para desplegar en Render o Railway.

### Seguridad de la información oculta (importante)
- El servidor **nunca** envía a un cliente la combinación de otro jugador **hasta el final de la partida**, ni las pujas de otros jugadores mientras la subasta esté abierta.
- Cada cliente solo recibe una "vista" de la partida filtrada para él.
- Valida **todo** en el servidor: fase correcta, jugador autorizado, puja válida, fichas que realmente le pertenecen, casillas vacías, etc.
- **Reconexión:** al unirse, el jugador recibe un token guardado en `localStorage`; si recarga la página o pierde la conexión, recupera su sitio, su combinación, sus monedas y su puja pendiente.

---

## 4. Funcionalidad

### 4.1 Salas y roles
- Pantalla de inicio: **Crear sala** o **Unirse con código** (código corto de 4–5 letras) + elegir nombre.
- **Anfitrión** (quien crea la sala) = el "staff" del Discord. Controla el ritmo de la partida: empezar, repartir fichas, abrir y cerrar la subasta, pasar a la siguiente ronda. Puede **jugar también** (casilla "Yo también juego", activada por defecto).
- Lobby con lista de jugadores conectados, opción de expulsar y botón **Empezar partida** (mínimo 2 jugadores).
- Al empezar se asignan las combinaciones al azar (equivale al `/combinacion` del bot, que era secreto y de un solo uso).

### 4.2 Flujo de una ronda (máquina de estados)
`LOBBY → (por ronda) FICHAS → PUJAS_ABIERTAS → RESOLUCION → [NEGOCIACION] → COLOCACION → RONDA_CERRADA → … → FIN`

1. **Fichas:** el anfitrión pulsa *Repartir fichas* → el servidor sortea 5+5 fichas y las muestra a todos.
2. **Pujas abiertas:** el anfitrión pulsa *Abrir subasta* (equivale a `/evento-colores panel`). Cada jugador ve dos campos (A y B) y un botón *Enviar/Actualizar puja*, con las monedas disponibles y la suma restante. Se ve un indicador de **quién ya ha enviado puja** (sin cantidades) y un **temporizador opcional** que el anfitrión puede configurar (por defecto sin límite).
3. **Resolución:** el anfitrión pulsa *Cerrar subasta* (equivale a `/evento-colores cerrar`) o salta el temporizador. El servidor calcula, aplica D4–D7, anuncia ganadores con una pequeña animación de revelación, descuenta monedas y devuelve las del resto.
4. **Colocación (caso normal):** el ganador real ve sus 5 fichas y **hace clic en el tablero** para colocar cada una (selecciona ficha → clic en casilla libre; permite deshacer antes de confirmar). Al confirmar, se muestra un registro público en formato del juego: `Rosa A3, Azul C7, …`.
5. **Ronda cerrada:** se actualiza el marcador de monedas y se pasa a la siguiente ronda.

### 4.3 Colocación
- Las fichas se colocan por clic/toque, **no escribiendo coordenadas**. Aun así, el tablero muestra siempre las etiquetas A–H y 1–8 y un **historial de jugadas** con la notación `Color A3` para quien siga la partida por voz en Discord.
- Si el ganador no coloca en un tiempo configurable (por defecto sin límite), el anfitrión puede **forzar colocación aleatoria**.

### 4.4 Negociación (empate)
- Los dos ganadores empatados entran en una pantalla de negociación visible para todos (los demás ven quién negocia, sin detalles que no sean públicos).
- Cada uno **elige 3 de sus 5 fichas** (las otras 2 se descartan).
- Cualquiera de los dos puede **proponer una colocación** de las 6 fichas en casillas libres (clic en el tablero sobre una vista previa). El otro puede **Aceptar**, **Rechazar y contraproponer** o **Declarar sin acuerdo**.
- Al aceptar, se colocan las 6 fichas. Si hay "sin acuerdo" o expira el tiempo (D9), la ronda es **nula** y ambos pierden la puja.

### 4.5 Marcador y vista del jugador
- Siempre visible: mi **combinación secreta** (tres medallones como en la imagen, bajo el tablero) con un botón **ocultar/mostrar** (importante si comparten pantalla en Discord), mis monedas, la ronda actual (n/10) y la lista de jugadores con sus monedas.
- Botón **"Resaltar mis apariciones"**: dibuja contornos rosas sobre las apariciones de **mi** combinación, como en `referencias/ejemplo_tablero.png`, con contador en vivo ("ahora mismo tienes 2").
- No se muestran las combinaciones ni los contadores de los demás hasta el final.

### 4.6 Fin de partida
- Se revelan **todas las combinaciones** y se calcula el recuento de cada jugador.
- Pantalla de resultados con ranking, ganador/es destacado/s y selector para **resaltar sobre el tablero las apariciones de cualquier jugador**.
- Botones del anfitrión: **Nueva partida con los mismos jugadores** (equivale a los `reset-*` del bot) y **Cerrar sala**.

---

## 5. Cálculo de apariciones (motor)

- Recorre cada ventana de 3 casillas consecutivas en las 4 direcciones (horizontal, vertical, diagonal ↘, diagonal ↗).
- Una ventana cuenta si sus colores, leídos en un sentido **o** en el contrario, coinciden con la combinación.
- Como las combinaciones tienen 3 colores distintos, una ventana nunca cuenta dos veces.
- **Las apariciones que comparten casillas cuentan por separado** (en la imagen de ejemplo hay 4 apariciones y algunas comparten ficha).
- Devuelve el número y las **coordenadas exactas** de cada aparición (para dibujar el resaltado).

---

## 6. Diseño y experiencia

- Estilo **kawaii morado/princesas** igual al de las imágenes de referencia: borde decorativo con flores y estrellas, fondo azul-morado oscuro, fichas con forma de medallón con un gatito con corona. Recrea el tablero y las fichas en **CSS/SVG** con ese estilo (no uses la imagen entera como fondo); puedes inspirarte en los colores y formas de `referencias/`.
- **Accesibilidad:** además del color, cada ficha lleva un símbolo o patrón distinto (por ejemplo ✦ ● ▲ ♥ ◆) para que se distingan con daltonismo. Contraste suficiente en textos.
- **Responsive:** debe ser jugable desde móvil (la mayoría jugará en un teléfono mientras habla por Discord).
- Animaciones sutiles al colocar ficha, revelar ganadores y resaltar apariciones. Respeta `prefers-reduced-motion`.
- Todos los textos de la interfaz en **español**. Mensajes claros de error ("Tu puja supera tus monedas disponibles").
- Incluye una pestaña/modal **"Cómo se juega"** con un resumen corto de las reglas y el ejemplo de 15 vs 17 monedas.

---

## 7. Calidad y pruebas

- **Tests unitarios del motor** (Vitest o Jest), mínimo para:
  - Reparto de combinaciones (únicas, sin inversas, distintos colores).
  - Cálculo de apariciones: horizontal, vertical, diagonales, sentido inverso, solapamientos, tablero vacío.
  - Resolución de ronda: ganador normal (15 vs 17), empate entre ganadores (negociación), D4–D7, devolución de monedas al resto, pujas inválidas.
  - Negociación: acuerdo, "sin acuerdo", expiración.
- **Test de integración** con dos o tres clientes Socket.IO simulados jugando una partida entera, comprobando además que **nunca se filtra** información oculta (combinaciones o pujas ajenas) en los mensajes del servidor.
- `npm test` debe pasar antes de darme el trabajo por terminado.

---

## 8. Entregables

1. Código completo y funcionando en esta carpeta.
2. `README.md` con: cómo ejecutarlo en local, cómo desplegarlo, capturas o descripción de pantallas, y una sección **"Decisiones y supuestos (D1–D12)"** con lo que hayas implementado.
3. Pruebas pasando.

## 9. Cómo quiero que trabajes

1. Empieza con un **plan breve** (estructura de carpetas, modelo de datos, mensajes de Socket.IO) y espera mi visto bueno **solo si ves algo que contradiga este documento**; si no, continúa.
2. Orden sugerido: (a) motor + tests, (b) servidor y salas, (c) cliente con las pantallas, (d) pulido visual y accesibilidad, (e) README y despliegue.
3. Haz commits pequeños y descriptivos por cada paso.
4. Si encuentras un hueco en las reglas que no esté en la tabla ⚠, elige la opción más simple, anótala en el README y sigue.

## 10. Fuera de alcance (por ahora)

Cuentas de usuario, base de datos persistente, bots/IA, integración con Discord, chat dentro de la web, modo espectador.
