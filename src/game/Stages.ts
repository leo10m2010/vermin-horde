// Original gothic-horror stage definitions. Each stage swaps the ground
// texture's palette (see `createGroundMesh` in `src/render/WorldGround.ts`)
// so runs feel visually distinct, matching Vampire Survivors' varied
// backdrops (graveyard, forest, library, ...) while staying fully
// procedural - no external art, just three hex colors per stage.

export interface StageDef {
  id: string;
  name: string;
  description: string;
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
    groundBaseColor: '#232a35',
    groundFleckColorA: '#3a4658',
    groundFleckColorB: '#12161f',
    fogTint: '#0a0e1a',
  },
  {
    id: 'cursed_forest',
    name: 'Bosque Maldito',
    description: 'Árboles retorcidos ocultan algo que respira entre las sombras.',
    groundBaseColor: '#1c2417',
    groundFleckColorA: '#2e1f3d',
    groundFleckColorB: '#101a0c',
    fogTint: '#140a1c',
  },
  {
    id: 'ruined_library',
    name: 'Biblioteca en Ruinas',
    description: 'Tomos prohibidos y polvo antiguo. El conocimiento tiene un precio.',
    groundBaseColor: '#3a2a1c',
    groundFleckColorA: '#5c4526',
    groundFleckColorB: '#211408',
    fogTint: '#1a0f08',
  },
];
