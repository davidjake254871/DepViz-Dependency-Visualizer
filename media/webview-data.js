// webview-data.js
(function(){
  const D = globalThis.DepViz || (globalThis.DepViz = {});
  const S = D.state;

  function recomputeMissingEdges() {
    const funcs = S.data.nodes.filter(n=>n.kind==='func');
    const modules = new Map(S.data.nodes.filter(n=>n.kind==='module').map(m=>[m.id, m]));
    const nameToFns = new Map(); // function name -> array of nodes
    for (const f of funcs){
      const nm = (() => {
        const s = String(f.label||'');
        const mFn = /([A-Za-z_][A-Za-z0-9_]*)\(\)\s*$/.exec(s);
        return mFn ? mFn[1] : s.trim();
      })();
      if (!nm) continue; if (!nameToFns.has(nm)) nameToFns.set(nm, []); nameToFns.get(nm).push(f);
    }
    // compute import preferences per module by re-parsing module.source
    const importPrefs = new Map(); // moduleId -> Set(moduleId)
    for (const [mid, m] of modules){
      const src = String(m.source || '');
      const targets = new Set();
      src.replace(/^(?:from\s+([\w\.]+)\s+import|import\s+([\w\.]+))/gm, (_,a,b)=>{ const t=a||b; if (t) targets.add(`mod_${h(t)}`); return ''; });
      src.replace(/^\s*(?:import\s+(?:[^'"\n]+)\s+from\s+['"]([^'"\n]+)['"]|import\s+['"]([^'"\n]+)['"]|const\s+[^=]+=\s*require\(\s*['"]([^'"\n]+)['"]\s*\)|require\(\s*['"]([^'"\n]+)['"]\s*\))/gm, (_,$1,$2,$3)=>{ const t=$1||$2||$3; if (t) targets.add(`mod_${h(t)}`); return ''; });
      const exist = new Set(); for (const id of targets){ if (modules.has(id)) exist.add(id); }
      importPrefs.set(mid, exist);
    }
    const have = new Set(S.data.edges.map(e=>`${e.from}->${e.to}:${e.type}`));
    for (const f of funcs){
      const code = String(f.snippet||'');
      const p = D.indices?.nodeMap?.get(f.parent);
      const callerMod = (p && p.kind === 'class') ? p.parent : f.parent;
      const prefMods = importPrefs.get(callerMod) || new Set();
      const names = new Set();
      // only bare identifiers that are NOT preceded by a dot (skip obj.name())
      // and skip obvious keywords
      const KW = /^(new|class|if|for|while|switch|return|function)$/;
      code.replace(/(?<!\.)\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, (_,$name)=>{
        const name = String($name);
        if (!KW.test(name)) names.add(name);
        return '';
      });
      for (const name of names){
        const cands = nameToFns.get(name) || [];
        if (!cands.length) continue;
        let best = null;
        for (const cand of cands){
          if (cand.id === f.id) continue;
          const cp = D.indices?.nodeMap?.get(cand.parent);
          const candMod = (cp && cp.kind === 'class') ? cp.parent : cand.parent;
          if (prefMods.has(candMod)) { best = cand; break; }
        }
        if (!best) best = cands.find(c=>c.id!==f.id) || null;
        if (best){ const key = `${f.id}->${best.id}:call`; if (!have.has(key)) { S.data.edges.push({ from: f.id, to: best.id, type: 'call' }); have.add(key); } }
      }
    }
  }

  function h(s){
    // match src/core/hash.ts (FNV-1a 32-bit, zero-padded)
    let h = 2166136261 >>> 0;
    for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h>>>0).toString(16).padStart(8,'0');
  }

  function mergeArtifacts(payload){
    // Support hard replace mode as a guard (also handled by message layer, but make idempotent)
    if (payload && payload.replace) {
      S.data.nodes = [];
      S.data.edges = [];
    }
    const incoming = (payload && Array.isArray(payload.nodes)) ? payload.nodes : [];
    const incomingById = new Map(incoming.map(n => [n.id, n]));

    // Build next node list by replacing existing nodes when IDs match.
    const nextNodes = [];
    const seenIds = new Set();
    for (const old of (S.data.nodes || [])) {
      const newer = incomingById.get(old.id);
      if (newer) {
        // Prefer incoming fields; keep layout if not provided.
        const merged = { ...newer };
        if (typeof merged.x !== 'number' && typeof merged.dx !== 'number') {
          if (typeof old.x === 'number') merged.x = old.x;
          if (typeof old.y === 'number') merged.y = old.y;
          if (typeof old.dx === 'number') merged.dx = old.dx;
          if (typeof old.dy === 'number') merged.dy = old.dy;
        }
        // If payload omits snippet/source, drop any stale ones.
        if (!('snippet' in newer)) delete (merged).snippet;
        if (!('source'  in newer)) delete (merged).source;
        // Ensure docked default for funcs
        if (merged.kind === 'func' && typeof merged.docked !== 'boolean') merged.docked = true;
        nextNodes.push(merged);
        seenIds.add(old.id);
        incomingById.delete(old.id);
      } else {
        nextNodes.push(old);
      }
    }
    // Any remaining incoming nodes are new → add them.
    for (const n of incomingById.values()) {
      const add = { ...n };
      if (add.kind === 'func' && typeof add.docked !== 'boolean') add.docked = true;
      nextNodes.push(add);
      seenIds.add(add.id);
    }
    S.data.nodes = nextNodes;

    // Edges: concat + dedupe (simple key).
    const allEdges = [...(S.data.edges || []), ...((payload && payload.edges) || [])];
    const keyOf = (e)=>`${e.from}->${e.to}:${e.type}`;
    const seenE = new Set();
    const dedup = [];
    for (const e of allEdges) {
      const k = keyOf(e);
      if (seenE.has(k)) continue;
      seenE.add(k);
      dedup.push(e);
    }
    S.data.edges = dedup;
  }

  function normalizeNodes(){
    for (const n of S.data.nodes) {
      if (n.kind==='func' && typeof n.docked==='undefined') n.docked = true;
      if (n.kind==='module' && typeof n.collapsed==='undefined') n.collapsed = true;
    }
  }

  function setAllModulesCollapsed(collapsed){
    const v = !!collapsed;
    for (const n of S.data.nodes) if (n.kind === 'module') n.collapsed = v;
  }

  D.data = Object.freeze({ recomputeMissingEdges, mergeArtifacts, normalizeNodes, setAllModulesCollapsed });
})();
