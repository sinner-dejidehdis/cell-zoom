// All interface text lives in language files. Only Chinese exists for now;
// adding English later means adding en.json with the same keys.
import zh from './zh.json';

export type LevelText = {
  name: string;
  hint: string;
  what: string;
  doing: string;
  rules: string;
  simplified: string[];
  sources: { label: string; url: string }[];
};

const dict = zh;

export const ui = dict.app;

export function levelText(key: string): LevelText {
  return (dict.levels as Record<string, LevelText>)[key];
}
