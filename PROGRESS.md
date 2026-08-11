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

## 6. Limitaciones conocidas / siguiente ronda sugerida

- **Números de daño no están instanciados**: cada uno es un `THREE.Sprite` + `CanvasTexture` propio (no comparte draw call). Se acotó el pool a 48 para limitar el peor caso, pero una reescritura a un atlas de dígitos instanciado eliminaría esta única excepción a la regla de "todo en un draw call".
- **El juego no tiene aún**: selección de dificultad explícita, logros/misiones, más de 2 jefes únicos, más de 3 escenarios, multijugador, guardado de progreso de la *run* en curso (solo el oro persiste entre partidas).
- **Balance**: se ajustó una vez tras pruebas automatizadas, pero no ha pasado por playtesting humano extenso — probable que algunas armas/pasivas estén sobre o infra-valoradas entre sí.
- **Sin tests unitarios** de la lógica de balance/daño en aislamiento — la cobertura actual es E2E (Playwright) sobre el juego completo, lo cual detecta regresiones de integración pero no errores aritméticos finos.

---

## 7. Stack técnico

Three.js r184, TypeScript 6 (`strict`, `noUnusedLocals`, `noUnusedParameters`), Vite 8, Playwright 1.60. Cero dependencias de arte/audio externas — todo el contenido visual y sonoro se genera en tiempo de ejecución.
