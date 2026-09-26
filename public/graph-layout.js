// Pure graph geometry, shared by the browser and regression tests.
function layoutGraph(nodes, edges) {
  const milestones = nodes.filter(node => node.type === 'milestone');
  const changes = nodes.filter(node => node.type === 'change');
  const specs = nodes.filter(node => node.type === 'spec');
  const parent = new Map(edges.filter(edge => edge.type === 'assignment').map(edge => [edge.to, edge.from]));
  const capabilities = new Map(changes.map(node => [node.key, edges.filter(edge => edge.from === node.key && edge.type === 'capability').map(edge => edge.to)]));
  const groups = milestones.map(node => ({ node, changes: changes.filter(change => parent.get(change.key) === node.key).sort((a, b) => a.label.localeCompare(b.label)) }));
  const grouped = new Set(groups.flatMap(group=>group.changes.map(n=>n.key)));
  const ungrouped = changes.filter(n=>!grouped.has(n.key));
  if(ungrouped.length) groups.push({node:{key:'__layout-only-hub'},changes:ungrouped});
  const order = new Map(specs.map((node, index) => [node.key, index]));
  // Barycentric passes keep linked changes and capabilities near one another.
  for (let pass = 0; pass < 6; pass++) {
    for (const group of groups) group.changes.sort((a, b) => {
      const average = node => { const links = capabilities.get(node.key) || []; return links.length ? links.reduce((sum, key) => sum + order.get(key), 0) / links.length : Infinity; };
      return average(a) - average(b) || a.label.localeCompare(b.label);
    });
    const changeOrder = new Map(groups.flatMap(group => group.changes).map((node, index) => [node.key, index]));
    specs.sort((a, b) => {
      const average = node => { const links = edges.filter(edge => edge.to === node.key && edge.type === 'capability'); return links.length ? links.reduce((sum, edge) => sum + changeOrder.get(edge.from), 0) / links.length : Infinity; };
      return average(a) - average(b) || a.label.localeCompare(b.label);
    });
    specs.forEach((node, index) => order.set(node.key, index));
  }
  const scale = Math.max(1, changes.length / 32, specs.length / 18, milestones.length / 8);
  const center = { x: 800 * scale, y: 525 * scale };
  const pos = new Map();
  const totalSlots = groups.reduce((sum, group) => sum + Math.max(1, group.changes.length), 0) || 1;
  const largestGroup = groups.reduce((best, group, index) => group.changes.length > groups[best].changes.length ? index : best, 0);
  const largestStart = groups.slice(0, largestGroup).reduce((sum, group) => sum + Math.max(1, group.changes.length), 0);
  const largestCenter = -Math.PI / 2 + 2 * Math.PI * (largestStart + Math.max(1, groups[largestGroup]?.changes.length || 0) / 2) / totalSlots;
  const hubOffset = largestCenter - 2 * Math.PI * (largestGroup + .5) / Math.max(1, milestones.length);
  let slot = 0;
  for (const group of groups) {
    const count = Math.max(1, group.changes.length);
    const hubAngle = hubOffset + 2 * Math.PI * (groups.indexOf(group) + .5) / Math.max(1, milestones.length);
    pos.set(group.node.key, { x: center.x + (milestones.length === 1 ? 0 : 215 * scale * Math.cos(hubAngle)), y: center.y + (milestones.length === 1 ? 0 : 175 * scale * Math.sin(hubAngle)) });
    for (const [index, node] of group.changes.entries()) {
      const theta = -Math.PI / 2 + 2 * Math.PI * (slot + index + .5) / totalSlots;
      pos.set(node.key, { x: center.x + 610 * scale * Math.cos(theta), y: center.y + 390 * scale * Math.sin(theta), angle: theta });
    }
    slot += count;
  }
  const targets = specs.map(node => {
    const linked = edges.filter(edge => edge.to === node.key && edge.type === 'capability').map(edge => pos.get(edge.from)?.angle).filter(angle => angle !== undefined);
    const x = linked.reduce((sum, angle) => sum + Math.cos(angle), 0);
    const y = linked.reduce((sum, angle) => sum + Math.sin(angle), 0);
    return { node, angle: linked.length ? (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI) : 0 };
  }).sort((a, b) => a.angle - b.angle || a.node.label.localeCompare(b.node.label));
  // Start after the largest empty arc so collision spacing does not wrap through
  // a cluster. Keep each capability as close as possible to its linked changes.
  const gaps = targets.map((entry, index) => ((targets[(index + 1) % targets.length]?.angle ?? entry.angle) + (index === targets.length - 1 ? 2 * Math.PI : 0) - entry.angle));
  const start = gaps.length ? (gaps.indexOf(Math.max(...gaps)) + 1) % targets.length : 0;
  const ordered = [...targets.slice(start), ...targets.slice(0, start)];
  const angles = ordered.map((entry, index) => entry.angle + (index >= targets.length - start ? 2 * Math.PI : 0));
  const minimumGap = .24 / scale;
  for (let index = 1; index < angles.length; index++) angles[index] = Math.max(angles[index], angles[index - 1] + minimumGap);
  if (angles.length > 1 && angles.at(-1) - angles[0] > 2 * Math.PI - minimumGap) {
    for (let index = 0; index < angles.length; index++) angles[index] = angles[0] + 2 * Math.PI * index / angles.length;
  }
  for (const [index, entry] of ordered.entries()) {
    const angle = angles[index];
    pos.set(entry.node.key, { x: center.x + 740 * scale * Math.cos(angle), y: center.y + 465 * scale * Math.sin(angle) });
  }
  return { pos, width: 1600 * scale, height: 1050 * scale };
}
