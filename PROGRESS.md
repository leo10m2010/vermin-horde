# Vermin Horde — Estado del Proyecto

**Género:** Survivors-like (horde survival / auto-battler), inspirado en *Vampire Survivors*.
**Motor:** Three.js + TypeScript + Vite. Cámara ortográfica inclinada, pixel-art 2D por billboards, todo el arte generado por código (Canvas 2D), sin dependencias de assets externos.
**Estado:** Jugable de principio a fin (menú → selección de personaje/escenario → partida → subida de nivel → jefes → victoria/derrota → tienda meta), pulido visual completo, sin errores conocidos, 60 FPS con 1000+ enemigos en pantalla.

Este documento existe para que cualquier persona (o cualquier IA) que retome el proyecto entienda en minutos qué existe, por qué se construyó así, y qué falta.

---

## 1. Cómo ejecutarlo

```bash
npm install        # primera vez
npm run dev         # servidor de desarrollo en http://127.0.0.1:5188
npm run build        # build de producción a dist/
npm run preview       # sirve el build de producción
npm test           # suite completa de Playwright (desktop + móvil)
npm run verify:visual    # solo el test de regresión visual
npm run inspect:canvas   # captura y analiza el canvas (FPS, draw calls, píxeles) sin abrir un navegador visible
```

**Controles:** WASD o joystick táctil para moverse. Los ataques son automáticos (auto-attack, como en el género). `Escape`/`P` pausa. El resto es UI con ratón/touch.

---

## 2. Qué hay implementado (checklist funcional)

### Core / loop
- Movimiento WASD con aceleración/fricción, cámara ortográfica inclinada (~58°) que sigue al jugador.
- Mapa abierto de 280×280 unidades, con 3 escenarios visuales distintos (paletas de color, no geometría distinta).
- HUD: nivel, barra de XP, temporizador, contador de muertes, barra de vida, oro.
- Menú principal, pausa, selector de personaje, selector de escenario, tienda, selector de mejoras (3 opciones), banner de jefe, aviso de minuto sobrevivido, pantallas de game over/victoria.
- Guardado persistente (`localStorage`) de oro y mejoras permanentes entre partidas.
- Condición de victoria: sobrevivir 20 minutos (`DIFFICULTY.rampSeconds`).

### Combate
- **11 armas**, cada una con su propia lógica de disparo/objetivo:
  `magic_wand` (homing al más cercano), `axe_throw` (arco con pierce), `knife_throw` (multi-disparo rápido), `fireball` (AoE al impacto), `garlic_aura` (aura continua, con anillo visual), `orbiter_blades` (orbitadores), `whip_strike` (melee direccional ambos lados), `arc_cross` (bumerán homing con retorno), `ember_wand` (objetivo aleatorio, daño alto), `rune_shard` (perforante que cambia de rumbo), `hex_flask` (zona de daño en el suelo).
- **Evolución de armas** (mecánica real de Vampire Survivors): nivel máximo (8) + poseer una pasiva específica → evoluciona con stats mejores y efecto visual grande. Tabla de emparejamientos en `src/weapons/*.ts` (`evolutionRequiresPassive`).
- **15 pasivas** cubriendo daño, vida, armadura, velocidad, área, cooldown, velocidad de proyectil, imán, regeneración, suerte, crítico, proyectiles extra, duración, ganancia de XP, revividas.
- Sistema de daño con crítico, armadura, invulnerabilidad tras golpe.
- Números de daño flotantes, hit-flash, partículas de impacto, estelas de proyectiles.

### Enemigos y progresión
- 8 tipos de enemigo (grunt, bat, skeleton, slime, wolf, ghost, spitter, brute) que se desbloquean progresivamente durante los primeros 5 minutos.
- Elites (más grandes, más HP, con aura violeta pulsante distintiva).
- 2 jefes (Rot King, Bone Colossus) con patrones de ataque telegrafiados (círculo de aviso → daño si el jugador sigue dentro), 4 oleadas de jefe por partida (dificultad escalada en repeticiones).
- Dirección de oleadas por presupuesto (`spawnBudget`) que crece de forma lineal de minuto 0 a minuto 20, con roll de elite creciente.
- Aviso visual cada minuto sobrevivido ("la horda crece").
- Animación de muerte (fundido/encogido, ~0.22s) y de aparición (fade-in, ~0.18s) en vez de aparecer/desaparecer instantáneamente.

### Personajes y escenarios (estilo Vampire Survivors, nombres originales)
- 6 personajes jugables, cada uno con arma inicial distinta y un rasgo pasivo único permanente para la partida.
- 3 escenarios (Cementerio de la Luna Llena, Bosque Maldito, Biblioteca en Ruinas) con paleta de suelo y tinte de niebla propios.

### Progresión meta (entre partidas)
- Oro persistente ganado por cada muerte.
- Tienda con 10 mejoras permanentes compradas con oro (vida, velocidad, suerte, armadura, daño, velocidad de proyectil, crítico, regeneración, multiplicador de oro futuro, revivida extra).
- Sistema de **Arcanas**: cada 5 minutos sobrevividos se ofrece una carta de bonus grande (más fuerte que una pasiva normal), hasta 5 por partida.

### Audio
- 100% procedural vía Web Audio API: música generativa de 3 capas (bajo/lead/hi-hat) que escala en intensidad con el peligro (enemigos cercanos, tiempo, vida baja), y efectos de sonido sintetizados para cada evento (golpe, muerte, recoger gema, subir de nivel, evolución de arma, aparición/muerte de jefe, game over/victoria).

### Rendimiento
- Renderizado por lotes instanciados (`InstancedBillboardBatch`, shader propio) — cientos/miles de sprites en **un solo draw call** por sistema (enemigos, proyectiles, gemas, partículas...).
- Object pooling en todos los sistemas de entidades (nada de `new`/GC en el hot path).
- Spatial hashing para consultas de colisión/objetivo sin caer en O(n²).
- **Medido:** ~1000-1500 enemigos activos simultáneos, 60 FPS estables, 6-40 draw calls totales según intensidad de combate (el pico ocurre solo con las 11 armas activas a la vez sobre 600+ enemigos).

---

## 3. Arquitectura

```
src/
  core/       Motor: Constants, EventBus, Loop, InputController, Renderer, ObjectPool, SpatialHash
  render/     Atlas de sprites compartido, InstancedBillboardBatch (shader), dibujo pixel-art, terreno
  entities/   Player, EnemyManager, ProjectileManager, GemManager (todos struct-of-arrays + pooling)
  enemies/    Catálogo de tipos de enemigo + WaveDirector (spawns, jefes, telegraphs)
  weapons/    Interfaz Weapon + 11 implementaciones + WeaponSystem (orquesta disparo + colisión genérica)
  systems/    UpgradeSystem (mejoras de nivel), ArcanaSystem (cartas especiales), CameraRig
  vfx/        Partículas, números de daño, anillos de telegraph, auras, estelas, flash de nivel
  ui/         UiRoot (menús base), CharacterSelect, StageSelect, Shop, ArcanaPicker, Icons (iconos propios)
  audio/      AudioManager, MusicEngine, síntesis de tonos/ruido
  game/       Game.ts (orquestador central), GameState, Characters, Stages, MetaProgression
```

**Patrón central:** todo estado de juego que puede llegar a cientos/miles de instancias (enemigos, proyectiles, gemas, partículas) se guarda en *typed arrays* planos (struct-of-arrays), nunca en objetos individuales — así el renderizado puede ser un solo `InstancedMesh` por sistema y el update loop no genera basura para el GC.

**Comunicación entre sistemas:** un `EventBus` tipado (`src/core/EventBus.ts`) desacopla todo — por ejemplo, `ParticleSystem`, `DamageNumbers`, `AudioManager` y `EliteAura` nunca se llaman entre sí ni conocen a `WeaponSystem`; todos reaccionan a eventos (`enemyHit`, `enemyKilled`, `levelUp`, `bossSpawned`, etc.) emitidos por quien corresponda. Esto es lo que permitió construir el juego con múltiples subagentes en paralelo sin colisiones: cada uno recibía la propiedad exclusiva de ciertos archivos y el contrato de eventos como única superficie compartida.

**`Game.ts`** es el único integrador: posee el loop, la escena de Three.js, y decide el orden de actualización cada frame (input → mundo → armas → colisiones → XP/nivel → cámara → HUD → render). Todo lo demás es una pieza intercambiable que Game.ts instancia y conecta.

### Hooks de testing (`window.__THREE_GAME_TEST_HOOKS__`)

El juego expone hooks deterministas para QA automatizado (usados extensivamente durante el desarrollo con Playwright):
`seed`, `setState('active-play'|'paused'|'levelup'|'gameover'|'victory')`, `spawnEnemies(n)`, `clearEnemies()`, `grantLevels(n)`, `setGodMode(bool)`, `forceBoss()`, más `window.__THREE_GAME_DIAGNOSTICS__` con FPS, posición, conteos de entidades y métricas del renderer en vivo.

---

## 4. Decisiones de diseño relevantes

- **¿Por qué billboards y no sprites 2D puros?** Para lograr la cámara "top-down inclinada" característica del género manteniendo pixel-art nítido: los sprites son planos 3D que siempre miran a cámara (billboard esférico calculado en el vertex shader a partir de `viewMatrix`), anclados por los pies, con `NearestFilter` para bordes duros.
- **¿Por qué nombres/arte originales en vez de clonar literalmente los assets de Vampire Survivors?** Se investigó el wiki oficial (armas, evoluciones, pasivas, personajes, arcanas) para clonar la **mecánica** con fidelidad, pero se generaron nombres, arte y textos propios en vez de reutilizar los activos con derechos de autor/marca de ese juego. El resultado es mecánicamente muy cercano (mismo sistema de evolución por pareja arma+pasiva, mismas categorías de stat, mismo flujo personaje→escenario→run→tienda) sin exponer al proyecto a un conflicto de IP.
- **Separación de enemigos:** los enemigos se empujan entre sí usando su tamaño *visual* (no solo su radio de colisión) para que una horda nunca se vea como una mancha sólida — esto se ajustó específicamente tras detectar en pruebas reales que el jugador y los monstruos individuales se volvían indistinguibles al amontonarse.
- **El jugador siempre visible:** el sprite del jugador se dibuja con `depthTest:false` y `renderOrder` alto, así nunca queda "enterrado" bajo una pila de enemigos, sin importar el orden de dibujado real.
- **Dificultad inicial:** el presupuesto de spawn inicial se bajó de 6 a 1.4 enemigos/seg tras comprobar en pruebas automatizadas que la curva original mataba a un jugador estático en menos de 20 segundos.

---

## 5. Cómo se construyó (para contexto histórico)

El proyecto se hizo en varias rondas, cada una coordinando subagentes en paralelo sobre archivos sin solape (mismo patrón: un "director" define contratos de API y propiedad de archivos, lanza agentes en background, integra el resultado, corre QA real con Playwright — no solo lectura de código — y corrige lo que encuentra jugando):

1. **Núcleo + vertical slice**: motor de render, pooling, spatial hash, jugador, cámara.
2. **Contenido base en paralelo**: enemigos/oleadas, armas/mejoras, sprites pixel-art, VFX/UI, audio.
3. **Clon de mecánicas de Vampire Survivors**: investigación del wiki oficial + expansión en paralelo de armas/evoluciones, personajes, menú gótico + escenarios, progresión meta (oro/tienda/arcanas).
4. **Pulido final ("game feel")**: efectos de subida de nivel/evolución, pulido de gemas, animación de proyectiles/estelas, animación de enemigos (muerte/spawn/aura de elite) — todo en paralelo sobre archivos disjuntos.

En cada ronda se verificó con: `tsc --noEmit`, `npm run build`, la suite de Playwright del repo, y sesiones de juego automatizadas reales (no solo capturas estáticas) midiendo FPS, buscando errores de consola, y jugando activamente con horda de 1000+ enemigos para encontrar bugs reales — así se detectaron y corrigieron, por ejemplo, el bug de enemigos/jugador "invisibles" al amontonarse y el crash silencioso de `AudioManager` en navegadores sin `AudioContext`.

---

## 6bis. Ronda 5 (2026-08-11/12): identidad de poderes, HUD superior, menú 2.5D

Pasada grande de pulido visual y de progresión sobre el juego ya jugable descrito arriba (sin tocar arquitectura, sin nuevos motores, sin destruir sistemas existentes):

- **Capa de metadata de armas** (`src/weapons/WeaponMetadata.ts`, nuevo): `attackPattern`, `directionLabel`, `evolvedName`, `evolutionRequirementName`, `levelSteps` (qué cambia exactamente en cada nivel 2-8) para las 11 armas, consumida por el level-up picker y el panel de pausa. La lógica de cada arma (`update()`/`levelUp()`) sigue siendo propia de cada archivo - esto es solo la capa descriptiva, nunca la fuente de verdad numérica.
- **Direccionalidad rehecha**: Knife ahora es puramente direccional (dirección de movimiento/última usada, ya no auto-apunta), con 1→2→3→4 cuchillos en niveles 1/2/4/7. Whip Strike golpea solo al frente en nivel 1 y desbloquea el golpe trasero en nivel 2 (antes golpeaba ambos lados desde el inicio). Holy Blades (orbiter) redistribuye 1→2→3→4→5 hojas en niveles 1/2/4/6/8.
- **Amount (`extraProjectiles`) auditado**: ahora afecta visiblemente a Knife, Magic Wand, Axe, Rune Shard y Arc Cross (proyectiles extra en abanico); Garlic/Whip/Orbiter/Fireball/Ember Wand/Hex Flask no responden a esa stat (no son "proyectiles" conceptualmente).
- **Altura visual 2.5D en proyectiles**: `ProjectileManager` soporta un `heightOffset` por instancia (puramente visual, la colisión sigue en X/Z); Axe tiene un pequeño arco de lanzamiento y Hex Flask un lob real hacia su zona de aterrizaje.
- **Level-up cards exactas**: cada tarjeta muestra icono, "Nivel X → Y" (o "Nueva"), tipo de mejora y la descripción exacta del cambio (`WeaponLevelStep`), no un texto genérico.
- **Límite de 6 pasivas distintas**: `UpgradeSystem.rollChoices` ya no ofrece un 7º tipo de pasiva una vez el jugador tiene 6 tipos distintos (sigue ofreciendo subir las que ya tiene).
- **Evolución retroactiva**: si un arma llega a nivel máximo antes de conseguir la pasiva que le falta, evolucionar ya no se pierde para siempre - `WeaponSystem.checkPendingEvolutions()` se re-verifica justo al recoger esa pasiva.
- **HUD superior** (`index.html`/`styles.css`/`Game.ts`): retrato circular real del personaje seleccionado (`drawCharacterPortrait`) + nombre + barra de HP con ribbon de daño rezagado + flash al golpe/pulso al curar, todo arriba a la izquierda; fila de 6 slots de poder (icono + nivel/★) abajo al centro.
- **CharacterSelect.ts rediseñado**: lista vertical a la izquierda, preview grande a la derecha (retrato, arma inicial con patrón de ataque, rasgo, 6 barras de stats reales calculadas vía `applyTrait()`, dificultad), paleta gótica unificada con el resto del juego.
- **MenuScene.ts** (nuevo, `src/render/`): escena Three.js independiente para el fondo del menú (luna, lápidas/columnas, monstruo lejano, personaje en idle, niebla/brasas instanciadas), intercambiada en el mismo `WebGLRenderer` cuando `phase==='menu'`. Intro por fases (fade → luces → dolly corto → idle) y `setReducedMotion`.
- **Sombras falsas instanciadas** (`ShadowBatch`, nuevo): un decal plano por jugador/enemigo, un draw call extra para hasta 1600 sombras - ya no parecen flotar sobre el suelo.
- **Panel de pausa "build"**: personaje + nivel, 6 poderes (nivel, evolucionado/listo-para-evolucionar/requiere-X) y pasivas poseídas con stacks.
- **QA de esta ronda**: `tsc --noEmit` limpio, `npm run build` OK, `npm test` (4/4, 1 skip esperado en mobile-safari), `inspect:canvas` (60 FPS, 29 draw calls, dentro de presupuesto), y un playtest scripted con Playwright real (no el Browser pane embebido, que no compone frames para este juego) cubriendo menú → personaje → run → 6 armas a nivel 8 con evolución → jefe → pausa/build → game over → restart → victory → vuelta al menú, sin errores de consola en ningún punto.

Pendiente natural para una próxima ronda: pase de balance dedicado tras estos cambios de dirección/Amount; profundizar props/columnas dentro de la ARENA de juego (no solo el menú); progresión visual "milestone" tan explícita como Knife/Whip/Orbiter para las 8 armas restantes (ya tienen metadata y escalado, pero no todas tienen un cambio de mecánica cada 2-3 niveles tan marcado).

## 6ter. Ronda 6 (2026-08-12): Enemy Art + Animation Pass

Pasada completa sobre la calidad visual de los 10 enemigos y los 3 jefes existentes. **No se añadieron enemigos nuevos.** Objetivo: que un personaje jugable y un enemigo puestos lado a lado parezcan del mismo juego y del mismo nivel artístico.

**Punto de partida (verificado en el código, no en la documentación):** los sprites de enemigos se dibujaban con `fillRect` plano — **0 llamadas a `fillRectShaded` y 0 argumentos `outlineColor` en todo `SpriteLibrary.ts`**, frente a 199 `fillRectShaded` en `SpriteLibraryCharacters.ts`. Y `EnemyTypeDef` tenía **un solo campo de animación, `walkClip`**, usado en los dos pases de render: no existían idle, attack, hit, special ni death. La muerte era el clip de andar encogido y desvanecido; el daño era solo el flash blanco del shader.

- **Arte nuevo en dos módulos propios** (`src/render/SpriteLibraryEnemyArt.ts`, `SpriteLibraryBossArt.ts`), con el mismo contrato de calidad que los personajes: outline de 1px, `fillRectShaded` en toda masa mayor bajo una luz superior-izquierda constante, cara real con dos ojos separados + brillo, extremidades (garras/pezuñas/pies) en su propio tono, y **rejilla cuadrada cuya fila inferior es el contacto con el suelo** (bat y ghost son la excepción deliberada: dejan filas vacías abajo para flotar). Se eliminó el arte plano antiguo de `SpriteLibrary.ts`.
- **Siluetas distintas**: grunt encorvado nudillo-suelo, bat en W de membranas, skeleton con costillar calado, slime en cúpula por spans de elipse (sin bandas), wolf cuadrúpedo horizontal, ghost en lágrima sin piernas, brute trapecio ancho, spitter panzudo sobre patas largas, ghoul de cabezas de cristal, gargoyle estatua alada baja. Verificado en una horda mezclada de 901 enemigos: cada tipo se reconoce por silueta dentro de la masa.
- **Sistema de animación de 6 estados** (`ENEMY_POSES` en `EnemyManager.ts`): idle / walk / attack / hit / special / death. `walkClip` pasó a `clipPrefix` y los 6 clips se resuelven **una vez en `registerType()`** (no por enemigo por frame). Las poses one-shot corren en su propio cabezal (`poseKind`/`poseRemaining`/`poseDuration`) para no tocar `animTimer`, que varias conductas usan como fuente de fase. Prioridad: attack > special > hit, de modo que recibir un golpe no cancela un telegraph.
- **Telegraphs reales, sin cambiar el timing de daño**: spitter y gargoyle mantienen su pose de carga durante **exactamente la ventana de telegraph que ya existía** (0.7s / 1.1s), así que radio, daño y tiempo de esquiva son idénticos — lo nuevo es que la criatura lo anuncia (saco inflándose, alas atrás + grietas violetas encendidas). El ghoul pasaba de andar a 1.4 de velocidad a lanzarse a 11 en un solo frame sin aviso: ahora se agazapa 0.34s antes (dirección fijada al comprometerse, para que esquivar funcione). Los jefes sostienen su windup durante el telegraph y golpean al resolverse; Duskfang tiene windup / pounce / landing.
- **Muerte propia por criatura** en vez del encogido compartido: el slime revienta en charco, el ghost se deshace hacia arriba, el skeleton se desarma, el gargoyle se hace escombros, el ghoul pierde los cristales primero, el Bone Colossus suelta su núcleo de alma y se desmonta el costillar. Los jefes tienen muerte más larga (0.95-1.25s vs 0.22s de la morralla).
- **Bug corregido en `PixelDraw.drawPixelGrid`**: el halo de outline se estampaba en `x-1`/`y-1` sin recortar, así que cualquier sprite que tocara el borde de su rejilla **pintaba dentro de la celda vecina del atlas compartido** — se veía en juego como barras oscuras flotando junto a criaturas sin relación. Ahora se recorta a la rejilla.
- **Bug corregido en pooling**: el ghoul no tenía `onSpawn`, así que un slot reciclado heredaba el estado de dash del ocupante anterior y podía lanzarse en el frame de aparición.
- **Escena de inspección**: hook `enemyShowcase()` (+ `setEnemyPose`, `getEnemyAnimStates`, `exitEnemyShowcase`) que congela un ejemplar de cada tipo y jefe en una rejilla junto al jugador, suspende oleadas y armas, y aleja la cámara. `npm run inspect:enemies` captura las 6 poses + un fotograma de combate real; `--row` y `--only` reencuadran para juzgar detalle de píxel.
- **QA de esta ronda**: `tsc --noEmit` limpio, `npm run build` OK, **suite Playwright 16 passed / 2 skipped** incluyendo `tests/enemy-animation.spec.ts` nuevo, que afirma sobre el juego corriendo (no sobre el atlas) que spitter, ghoul, gargoyle y jefes **entran de verdad en special y attack durante partida real** y que los enemigos dañados hacen flinch. Rendimiento sin regresión: 901 enemigos mezclados + jefe a 58 FPS con 29 draw calls; 893 grunts a 60 FPS con 11 draw calls. Atlas: 371 celdas (textura 1280x1280). Verificación visual real con Playwright headless (`channel:'chromium'`), no con el Browser pane embebido.

Pendiente detectado en esta ronda y **deliberadamente NO tocado** (fuera de alcance): el sprite por defecto del jugador (`registerPlayerSprites`) y todo el arte de armas/proyectiles, VFX y props de escenario siguen siendo `fillRect` plano sin outline — ahora quedan por debajo del listón de los enemigos; los elites siguen siendo el mismo sprite escalado con aura violeta en vez de una variante propia.

## 6quater. Ronda 7 (2026-08-12): Power pass — mecánicas, progresión y arte

**Auditoría de partida (verificada en código):** Whip leía `ctx.playerVX` y mantenía `horizontalFacing`, así que cambiaba de lado con el movimiento. Axe ya tenía ángulo base fijo pero su progresión no incluía Amount (solo evolved añadía una segunda hacha). Los números reales vivían inline en cada `update()` mientras `WeaponMetadata.ts` llevaba una descripción escrita a mano: dos fuentes que ya habían divergido. El arte de poderes era `fillRect` plano sin outline, muy por debajo de personajes/enemigos.

- **Single source of truth** (`src/weapons/WeaponProgression.ts`, nuevo): tabla explícita por nivel para los 11 poderes. El gameplay la lee (`effectAt`) y la UI la diferencia (`describeLevelUp`), así que una tarjeta **no puede** prometer un efecto que el arma no aplica — el texto se deriva de los mismos números que usa la simulación. Añadir un efecto = editar una fila.
- **WHIP — lado FIJO**: eliminados `playerVX`, `horizontalFacing` y el umbral direccional. `FIXED_SIDE = 1` constante. Lv1 golpea siempre a la derecha; Lv2 desbloquea el latigazo espejo (desfase de 60 ms, mismo ataque: un cooldown, un evento). Dos hitboxes explícitas vía `strikeBand()` exportada, y el sprite de cada latigazo se centra en la banda que acaba de dañar. Progresión Lv3 daño / Lv4 alcance / Lv5 cooldown / Lv6 anchura / Lv7 daño+área / Lv8 máximo.
- **AXE — Amount como columna vertebral**: 1 hacha Lv1 → 2 Lv2 → 3 Lv5, abanico simétrico alrededor del ángulo base fijo (arriba). Arco 2.5D real: subida, ápice, caída, con rotación, escala por altura y **sombra en el suelo** que se encoge y aclara según sube. Lv3/6 daño, Lv4/7 penetración, Lv8 daño+área.
- **Power Art Pass** (`src/render/SpriteLibraryPowerArt.ts`, nuevo): los 11 poderes reautorizados con outline de 1px, `fillRectShaded`, núcleo caliente/borde frío y animación real — látigo de 4 fotogramas (enrollado → extensión → chasquido → estela), hacha de acero con astil y agarre, dardo del Magic Wand puntiagudo (deliberadamente distinto de la bola de fuego), cuchillo con guarda y empuñadura, fireball con llamas, hoja sagrada, cruz bumerán con variante de RETORNO en oro (fase legible), ember agrietado, esquirla rúnica con glifo, frasco de cristal con líquido. Retirados los sprites planos antiguos de `SpriteLibrary.ts`/`SpriteLibraryWeapons2.ts`.
- **Level-Up UI**: la tarjeta muestra icono, nombre, `Nivel X → Y`, tipo, cambio principal y **línea de detalle con los números reales** (`1 lado → ambos lados`, `1 → 2 proyectiles`), más entrada escalonada de 60 ms, pulso del icono, hover y respuesta al pulsar, todo respetando `prefers-reduced-motion`.
- **Power showcase** (`powerShowcase(id, level|'evolved')` + `npm run inspect:powers`): aísla un arma a un nivel con dummies congelados y captura el fotograma **mientras dispara** (espera a que haya proyectiles vivos y congela la sim), no un arena vacío.
- **Bugs reales corregidos**: `WeaponSystem.reset()` no soltaba los visuales sin caducidad — las hojas del orbiter (`life:Infinity`) y el anillo de Garlic quedaban huérfanos y se acumulaban en cada re-loadout. El latigazo se quedaba atrás en el mundo mientras el jugador caminaba (se detectó porque un test midió 0.18 de desviación en Z); ahora va anclado al portador durante su vida.
- **QA**: `tsc` limpio, `npm run build` OK, **suite Playwright 42 passed / 2 skipped**, incluyendo `tests/power-mechanics.spec.ts` nuevo (13 tests) que afirma sobre el juego real: Whip Lv1 solo golpea a la derecha moviéndose en las 8 direcciones; Lv2 ambos lados; la banda nunca sale de la línea Z del jugador; Axe 1/2/3 hachas y `vz < 0` siempre; Knife sí sigue el movimiento; Holy Blades 1/2/3/4/5 contadas en pantalla; radio dibujado de Garlic == radio de daño; y que ningún arma pasa más de 2 niveles sin un cambio perceptible. Rendimiento sin regresión (60 FPS, 11-13 draw calls en el showcase).

### Ronda 7b — cierre del power pass

- **Evoluciones visibles**: los 11 poderes intercambian ahora a su sprite `*_evo` al evolucionar (dardo violeta del Archmage, hacha dorada, Inferno Core azul-blanco, dagas espectrales, látigo verde veneno, hojas doradas, cruz radiante, ember violeta, esquirla esmeralda, frasco púrpura). El orbiter reconstruye su anillo al evolucionar porque sus hojas son instancias `life:Infinity` creadas una sola vez.
- **Arc Cross OUT vs RETURN**: `ProjectileManager.setVisual()` nuevo; la cruz cambia de acero frío a oro cálido en el instante en que da la vuelta, así que la fase de ida y la de vuelta se distinguen de un vistazo sin cambiar la silueta.
- **Los 11 consumen la tabla**: Arc Cross, Ember Wand, Rune Shard y Hex Flask migrados a `effectAt()` — ya no queda ninguna fórmula inline compitiendo con la tabla de progresión.
- **Presentación de evolución (fase 6)**: banner propio (`UiRoot.showEvolution`) con flash radial, tarjeta con icono animado y `nombre base → nombre evolucionado` tachado, ~1.6s y **sin bloquear la run** (la simulación sigue corriendo debajo).
- **Daño por poder (sección 30)**: `EnemyManager.damage()` acepta `sourceWeaponId`, `enemyHit` lo transporta y Game lleva un ledger por arma (máx. 6 entradas). Las pantallas de victoria/derrota muestran barras ordenadas con icono, nombre y porcentaje. Verificado en combate real: Aura de Ajo 41% / Látigo 23% / Bola de Fuego 19% / Hacha 10% / Cuchillo 7%.
- **HUD (sección 29)**: los slots marcan *listo para evolucionar* con un pulso dorado en cuanto se cumple el requisito (la pasiva entra en la firma de diff, así que reacciona al recogerla, no solo al subir de nivel) y *evolucionado* con borde brillante, más `title` descriptivo.
- **Bug corregido**: si la run terminaba con el selector de mejora abierto, quedaban dos overlays apilados y el picker muerto seguía siendo clicable detrás del panel de resultados.

### Ronda 7c — Main Menu y cierre de UI

- **Una sola atmósfera (sección 23)**: `MenuBackdrop.ts` **eliminado**. Renderizaba niebla, brasas y murciélagos en DOM/CSS *encima* de `MenuScene`, que ya dibuja su propia niebla y brasas en Three.js — dos sistemas atmosféricos compitiendo delante uno del otro. Ahora la escena 3D es la única fuente: los murciélagos se movieron a un `InstancedBillboardBatch` propio dentro de `MenuScene`, con profundidades reales (z −8.5/−12/−10.5) para que se entrelacen con las lápidas en vez de flotar planos por delante. Tinte casi negro y tamaño reducido: son siluetas lejanas contra la luna, no enemigos de partida. ~185 líneas de CSS muertas borradas.
- **Composición del menú (sección 24)**: el panel ya no tapa la escena — se ancla a un lado con fondo semitransparente y `backdrop-filter`, dejando visibles la luna, la niebla y el personaje en idle. Botones apilados con entrada secuencial (70 ms entre cada uno), hover con desplazamiento lateral corto, título y subtítulo con entrada propia. Bajo 720 px vuelve a centrarse, que es lo único razonable en móvil. `showMainMenu({ canContinue })` añade **CONTINUAR** cuando hay una run pausada.
- **Transiciones compartidas (sección 31)**: un vocabulario mínimo — fade del overlay + slide/scale del panel — aplicado a `.ui-overlay`/`.ui-panel`, así que Main Menu → Character Select → Stage Select → run ya no son cortes secos. Dos keyframes, no una librería, y todo bajo `prefers-reduced-motion`.
- **Ya estaban hechos de la ronda 5** (verificado, no rehecho): Character Select ya usa `getWeaponMetadata` en vez de una lista manual de nombres de arma (sección 26), y el panel de pausa ya muestra personaje + poderes con estado de evolución + pasivas con stacks (sección 28).
- **Responsive (sección 33)**: comprobado a 1920×1080, 1366×768 y 390×844 — sin scroll horizontal ni vertical en ninguna, sin errores de consola.

### Ronda 8 (2026-08-12): Garlic Aura como zona de suelo

**Causa real (encontrada en el código, no supuesta):** la geometría del aura YA estaba correctamente tumbada en el plano XZ (`rotateX(-PI/2)`), así que la perspectiva nunca fue el problema. Lo que fallaba era **qué se dibujaba encima**: `RingGeometry(0.78, 1, 10)` — un contorno hueco, con solo 10 segmentos radiales, en aditivo y color plano. Un anillo duro y vacío no le da al ojo ninguna superficie a la que agarrarse contra el piso, y los 10 segmentos hacían visible el decágono (se cuentan los lados rectos en la captura). De ahí la lectura de "aro suspendido".

- **`GroundAreaRings` reescrito**: un disco relleno (quad plano + disco recortado en el fragment shader) con todo pintado proceduralmente en un solo draw: lavado base casi uniforme, ondas concéntricas avanzando hacia fuera, segunda banda más lenta en sentido contrario, caída suave en el borde y pulso por tick. Círculo perfecto a cualquier tamaño — ya no hay segmentos visibles.
- **Blending normal en vez de aditivo**: la zona se lee como algo pintado sobre el suelo del mundo y no como un brillo delante de él, y los enemigos que la pisan no se queman.
- **Orden de dibujado**: suelo (0) → aura (0.5) → sombra del personaje (1) → sprites. El aura pasó de `y = ground + 0.02` a `ground + 0.004`, por debajo de la sombra de contacto: si el aura tapa la sombra, el personaje deja de parecer plantado.
- **Radio visual == hitbox**: el disco se escala 1:1 con el radio de daño y la caída del borde se estrecha a 0.86→1.0, así que el borde visible coincide con el círculo que hace daño en vez de quedarse corto.
- **Pulso por tick**: `groundRings.pulse()` en cada tick de daño — hinchazón breve de brillo/densidad. Como se dispara desde el propio tick, la frecuencia del pulso comunica sola las mejoras de cooldown.
- **Progresión y evolución**: el radio dibujado crece de verdad (2.2 → 3.2 → 4.3 → 5.16 evolucionado, medido en pantalla), las ondas se re-escalan en unidades de mundo para que un aura grande muestre más anillos en vez de los mismos estirados, y la evolución cambia a violeta **siguiendo como ground effect** — nunca aro ni escudo.
- **Hex Flask**: usa el mismo renderer, así que sus charcos heredan la corrección sin tocar el arma.

**QA visual real** (`npm run inspect:garlic` → `scripts/inspect-garlic-aura.mjs`): aura a Lv1/Lv4/Lv8, evolucionada, con 70 enemigos entrando y saliendo, con el jugador quieto y en movimiento, y la zona de Hex Flask. Elipse medida en pantalla ≈0.82-0.85 de alto/ancho frente al sin(58°)=0.848 que exige la cámara. 60 FPS, 12-13 draw calls en la escena aislada, sin errores de consola. Suite: 22/22 en desktop-chrome, incluido el test que compara radio dibujado contra radio de daño.

## 6. Limitaciones conocidas / siguiente ronda sugerida

- **Números de daño no están instanciados**: cada uno es un `THREE.Sprite` + `CanvasTexture` propio (no comparte draw call). Se acotó el pool a 48 para limitar el peor caso, pero una reescritura a un atlas de dígitos instanciado eliminaría esta única excepción a la regla de "todo en un draw call".
- **El juego no tiene aún**: selección de dificultad explícita, logros/misiones, más de 2 jefes únicos, más de 3 escenarios, multijugador, guardado de progreso de la *run* en curso (solo el oro persiste entre partidas).
- **Balance**: se ajustó una vez tras pruebas automatizadas, pero no ha pasado por playtesting humano extenso — probable que algunas armas/pasivas estén sobre o infra-valoradas entre sí.
- **Sin tests unitarios** de la lógica de balance/daño en aislamiento — la cobertura actual es E2E (Playwright) sobre el juego completo, lo cual detecta regresiones de integración pero no errores aritméticos finos.

---

## 7. Stack técnico

Three.js r184, TypeScript 6 (`strict`, `noUnusedLocals`, `noUnusedParameters`), Vite 8, Playwright 1.60. Cero dependencias de arte/audio externas — todo el contenido visual y sonoro se genera en tiempo de ejecución.
