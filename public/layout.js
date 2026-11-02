function radialSeeds(nodes, links) {
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const { source, target } of links) {
    adj.get(source).push(target);
    adj.get(target).push(source);
  }
  const remaining = new Set(adj.keys());
  while (remaining.size) {
    const root = [...remaining].sort((a, b) => adj.get(b).length - adj.get(a).length || a.localeCompare(b))[0];
    const order = [{ id: root, depth: 0, children: [], weight: 1 }];
    remaining.delete(root);
    for (const branch of order) for (const id of adj.get(branch.id)) {
      if (!remaining.delete(id)) continue;
      const child = { id, depth: branch.depth + 1, children: [], weight: 1 };
      branch.children.push(child);
      order.push(child);
    }
    for (const branch of [...order].reverse()) branch.weight += branch.children.reduce((sum, c) => sum + c.weight, 0);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const place = (branch, start, end) => {
      const angle = (start + end) / 2;
      Object.assign(byId.get(branch.id), { x: Math.cos(angle) * branch.depth * 220, y: Math.sin(angle) * branch.depth * 220 });
      const span = end - start;
      const total = branch.children.reduce((sum, c) => sum + c.weight, 0);
      for (const child of branch.children) {
        const next = start + span * child.weight / total;
        place(child, start, next);
        start = next;
      }
    };
    place(order[0], 0, Math.PI * 2);
  }
}

export function familyLayout(graph, cards, force) {
  const nodes = graph.people.map((p) => ({ id: p.id, radius: cards.get(p.id).width / 2 }));
  nodes.push(...graph.unions.map((u) => ({ id: u.id, radius: 14 })));
  if (!nodes.length) return { layout: { width: 0, height: 0 }, pos: new Map() };
  const links = graph.unions.flatMap((u) => [
    ...u.parents.map((p) => ({ source: p, target: u.id, gap: 28 })),
    ...u.children.map((c) => ({ source: u.id, target: c, gap: 76 })),
  ]);
  radialSeeds(nodes, links);
  const collision = force.forceCollide((n) => n.radius + 18).iterations(4);
  const simulation = force.forceSimulation(nodes).stop()
    .force('links', force.forceLink(links).id((n) => n.id).distance((e) => e.source.radius + e.target.radius + e.gap).strength(1))
    .force('charge', force.forceManyBody().strength(-150))
    .force('collision', collision)
    .force('x', force.forceX(0).strength(0.02))
    .force('y', force.forceY(0).strength(0.02));
  simulation.tick(500);
  simulation.force('links', null).force('charge', null).force('x', null).force('y', null).alpha(0).tick(100);
  const left = Math.min(...nodes.map((n) => n.x - n.radius)), top = Math.min(...nodes.map((n) => n.y - n.radius));
  const right = Math.max(...nodes.map((n) => n.x + n.radius)), bottom = Math.max(...nodes.map((n) => n.y + n.radius));
  const pos = new Map(nodes.map((n) => [n.id, { ...cards.get(n.id), x: n.x - n.radius - left, y: n.y - n.radius - top, width: n.radius * 2, height: n.radius * 2 }]));
  return { layout: { width: right - left, height: bottom - top }, pos };
}
