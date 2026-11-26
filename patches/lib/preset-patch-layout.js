'use strict';

// company-preset-patch-layout-v1
//
// Since 0.1.7 the shipped session presets are rows in
// dsh-web-app/presets/<name>.patch.yml, and dsh-web-app turns the profile-level
// skill-filesystem / agent-instructions rows off (`disabled: true`). The desk
// overlay still pins those profile rows, so nothing reached the session:
//   - the session's skill-filesystem kept its defaults: it listed ~/.agents/skills
//     and whatever the person keeps there, never the company skills cache, so
//     `skill company-mail` answered "unknown or no longer available" (the company
//     system prompt tells the model to load it) and the model went looking with
//     `glob **/company-mail/SKILL.md` over the share (30 s tool timeout);
//   - every skill call walked the share from cwd up looking for .agents/skills;
//   - agent-instructions had no project root marker, so a session on the share
//     walked up to $HOME/AGENTS.md / CLAUDE.md.
// This pins the preset's own rows. The skills cache path is computed in the
// preset (`!!js`, the home directory + .dsh-company-rc8/skills: the place
// start.command, start.ps1 and AppHost all build it), so no launcher has to
// rewrite a token in the kernel tree.

const MARK = 'company-preset-patch-layout-v1';

const SKILLS_DIR_JS =
  "!!js process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:os').homedir(), '.dsh-company-rc8', 'skills')";

function countMatches(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  return (text.match(g) || []).length;
}

// Returns { text, changed, error }. error is set (and text unchanged) when an
// anchor is missing or not unique: the kernel moved, do not guess.
function pinPresetPatchLayout(text) {
  if (text.includes(MARK)) return { text, changed: false };
  // skill-filesystem row with no config of its own.
  const skillRe =
    /^( +)- id: skill-filesystem\n\1  name: '@deepseek-ai\/dsh-skill-filesystem'\n(?!\1  config:)/m;
  const instrRe =
    /^( +)- id: agent-instructions\n\1  name: '@deepseek-ai\/dsh-agent-instructions'\n\1  config:\n\1    maxBytes: 65536\n(?!\1    projectRootMarkers:)/m;
  const nSkill = countMatches(text, skillRe);
  const nInstr = countMatches(text, instrRe);
  if (nSkill !== 1) return { text, changed: false, error: 'skill-anchor|expected=1|got=' + nSkill };
  if (nInstr !== 1) return { text, changed: false, error: 'instr-anchor|expected=1|got=' + nInstr };
  let out = text.replace(skillRe, (m, ind) =>
    m +
    ind + '  config:\n' +
    ind + '    includeDefaultRoots: false\n' +
    ind + '    watch: false\n' +
    ind + '    customSkillDirs:\n' +
    ind + '      - ' + SKILLS_DIR_JS + '\n');
  out = out.replace(instrRe, (m, ind) =>
    m +
    ind + '    projectRootMarkers:\n' +
    ind + '      - .company-root\n');
  out = out.replace(/\s*$/, '') + '\n# --- ' + MARK + ' ---\n';
  return { text: out, changed: true };
}

module.exports = { MARK, SKILLS_DIR_JS, pinPresetPatchLayout };
