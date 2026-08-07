import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    localStorage: dom.window.localStorage,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
  });
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  return dom;
}

test("strategy changes recalculate visible matches and a lot can enter Research", async () => {
  const dom = installDom();
  const React = await import("react");
  const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
  const { default: App } = await import("../src/App");
  const view = render(React.createElement(App));

  await waitFor(() => assert.match(view.getByText(/live lots match/i).textContent ?? "", /^\d+/));
  assert.ok(view.getByRole("heading", { name: "Recommended properties" }));
  const recommendationBriefs = view.getAllByText("Open research brief");
  assert.ok(recommendationBriefs.length > 0 && recommendationBriefs.length <= 10);
  assert.ok(view.getAllByRole("link", { name: "Parcel records ↗" }).length > 0);
  const before = view.getByText(/live lots match/i).textContent;
  const maxBidSlider = view.getAllByRole("slider")[0];
  fireEvent.change(maxBidSlider, { target: { value: "1000" } });
  await waitFor(() => assert.notEqual(view.getByText(/live lots match/i).textContent, before));

  fireEvent.change(maxBidSlider, { target: { value: "100000" } });
  const addButtons = await view.findAllByRole("button", { name: "Add to Research" });
  fireEvent.click(addButtons[0]);
  fireEvent.click(view.getByRole("button", { name: /Research\d+ properties under review/i }));
  await waitFor(() => assert.ok(view.getByRole("heading", { name: "Research queue" })));
  assert.ok(view.getByText(/Diligence gate/));
  assert.ok(localStorage.getItem("auction-watch-research-v2"));

  cleanup();
  dom.window.close();
});

test("every live lot has a unique stable identity and direct property link", async () => {
  const data = (await import("../data/lots.json", { with: { type: "json" } })).default;
  const identities = new Set(data.lots.map((lot) => lot.id));
  const urls = new Set(data.lots.map((lot) => lot.propertyUrl));
  assert.equal(identities.size, data.lotCount);
  assert.equal(urls.size, data.lotCount);
  assert.ok(data.lots.every((lot) => /^taxsale:\d+$/.test(lot.id) && /\/lot\/show\/id\/\d+$/.test(lot.propertyUrl)));
});
