// A sale across several devices is stored as one row per device per store
// (repair_price_sales), so a Black Friday sale is ~90 rows. Screens show it as
// one group per store; this is the one definition of "the same sale", shared
// by the Promotions tab and the shop TV so they cannot disagree.
export function groupSales(list) {
  var g = {}, order = [];
  (list || []).forEach(function(s) {
    var k = [s.store, s.label || "", s.repair, s.tier || "", s.off, s.starts_on, s.ends_on, s.state].join("|");
    if (!g[k]) { g[k] = []; order.push(k); }
    g[k].push(s);
  });
  return order.map(function(k) { return g[k]; });
}
