import { expect, test } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL });

for (const width of [1280, 760]) {
  test(`outreach rejection distinguishes submission and CRM confirmation at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await installMockBridge(page);
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "general",
              kind: 9,
            }) ?? false,
        ),
      )
      .toBe(true);
    const actionId = "8ca5bd14-00d4-45cc-88ec-4bb1609e7d4a";
    const source = await page.evaluate(
      ({ actionId, pubkey }) =>
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          id: "a".repeat(64),
          pubkey,
          content: [
            "# Outreach draft ready",
            "",
            "**Contact:** Arnaud — TEST SANS ENVOI",
            "",
            "## Draft",
            String.fromCharCode(96).repeat(3),
            "Bonjour Arnaud,",
            "Ceci est un brouillon de test. Aucun message ne sera envoyé pendant ce test.",
            String.fromCharCode(96).repeat(3),
            "",
            `crm-action:v1:${actionId}:outreach_approve:2099-01-01T00:00:00Z`,
          ].join("\n"),
        }),
      { actionId, pubkey: TEST_IDENTITIES.alice.pubkey },
    );
    if (!source) throw new Error("Missing mock card");
    const card = page.getByTestId("crm-outreach-action");
    await page.setViewportSize({ width, height: 1000 });
    await expect(
      card.getByRole("button", { name: "Reject draft" }),
    ).toBeVisible();
    await card.getByRole("button", { name: "Reject draft" }).click();
    await expect(card.getByTestId("crm-outreach-status")).toContainText(
      "Rejection submitted",
    );
    await expect(
      card.getByRole("button", { name: "Approve and send" }),
    ).toHaveCount(0);
    await waitForAnimations(page);
    await card.screenshot({
      path: testInfo.outputPath(`rejection-pending-${width}.png`),
    });
    const content = `# Outreach draft rejected\n\nCRM confirmed rejection.\n\n<!-- crm-outreach-result:v1:${actionId}:${source.id}:rejected:0:- -->`;
    // A different channel participant cannot confirm the original card.
    await page.evaluate(
      ({ content, pubkey }) =>
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content,
          pubkey,
        }),
      { content, pubkey: TEST_IDENTITIES.bob.pubkey },
    );
    await expect(card.getByTestId("crm-outreach-status")).toContainText(
      "Rejection submitted",
    );
    await page.evaluate(
      ({ content, pubkey }) =>
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          content,
          pubkey,
        }),
      { content, pubkey: TEST_IDENTITIES.alice.pubkey },
    );
    await expect(card.getByTestId("crm-outreach-status")).toContainText(
      "Draft rejected",
    );
    await expect(card).toContainText("Confirmed by CRM. No message was sent.");
    await expect(card).not.toContainText("Revision submitted");
    await expect(card.getByRole("button")).toHaveCount(0);
    await waitForAnimations(page);
    await card.screenshot({
      path: testInfo.outputPath(`rejection-confirmed-${width}.png`),
    });
  });
}
