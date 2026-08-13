// Original gothic-horror stage definitions. Each stage swaps the ground
// texture's palette (see `createGroundMesh` in `src/render/WorldGround.ts`)
// so runs feel visually distinct, matching Vampire Survivors' varied
// backdrops (graveyard, forest, library, ...) while staying fully
// procedural - no external art, just three hex colors per stage.

export interface StageDef {
  id: string;
  name: string;
  description: string;
  /**
   * Which prop catalogue this stage furnishes itself from (see
   * `STAGE_PROPS` in world/WorldProps.ts). Explicit rather than derived from
   * `id`: the two were silently out of sync before - every stage was handed
   * the graveyard set because the lookup used the stage id and the catalogue
   * was keyed by short names - and a named field makes that impossible to
   * reintroduce quietly.
   */
  propSet: 'graveyard' | 'forest' | 'library';
  /** Shown as a pill on the stage card. Ordering only; no gameplay effect yet. */
  difficulty: 'easy' | 'medium' | 'hard';
  /**
   * The one thing that genuinely differs about playing here, in the player's
   * words. Must describe something that is actually true of the stage - these
   * lines are about the real prop catalogue above.
   */
  feature: string;
  groundBaseColor: string; // hex
  groundFleckColorA: string; // hex
  groundFleckColorB: string; // hex
  fogTint?: string; // optional hex, for a subtle background/fog tint
}

export const STAGES: StageDef[] = [
  {
    id: 'moonlit_graveyard',
    name: 'Cementerio de la Luna Llena',
    description: 'Lápidas inclinadas bajo una luna enfermiza. Los muertos no descansan aquí.',
    propSet: 'graveyard',
    difficulty: 'easy',
    feature: 'Criptas y muros de piedra: mucha cobertura sólida para romper la horda.',
    groundBaseColor: '#232a35',
    groundFleckColorA: '#3a4658',
    groundFleckColorB: '#12161f',
    fogTint: '#0a0e1a',
  },
  {
    id: 'cursed_forest',
    name: 'Bosque Maldito',
    description: 'Árboles retorcidos ocultan algo que respira entre las sombras.',
    propSet: 'forest',
    difficulty: 'medium',
    feature: 'Troncos y peñascos: bloqueos bajos y anchos que estrechan las rutas.',
    groundBaseColor: '#1c2417',
    groundFleckColorA: '#2e1f3d',
    groundFleckColorB: '#101a0c',
    fogTint: '#140a1c',
  },
  {
    id: 'ruined_library',
    name: 'Biblioteca en Ruinas',
    description: 'Tomos prohibidos y polvo antiguo. El conocimiento tiene un precio.',
    propSet: 'library',
    difficulty: 'hard',
    feature: 'Estanterías y columnas: pasillos cerrados donde es fácil quedar rodeado.',
    groundBaseColor: '#3a2a1c',
    groundFleckColorA: '#5c4526',
    groundFleckColorB: '#211408',
    fogTint: '#1a0f08',
  },
];
