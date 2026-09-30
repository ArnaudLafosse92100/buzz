import { expect, test } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

test.use({ channel: process.env.PLAYWRIGHT_CHANNEL });

for (const width of [1280, 760]) {
  test(`subject choice never presents itself as email approval at ${width}`, async ({
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
    await page.evaluate(
      ({ pubkey }) =>
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          id: "c".repeat(64),
          pubkey,
          content: [
            "Follow-up for alice@example.test — FIXTURE, NO EMAIL",
            "crm-action-options:v1:followup_quote_select:" +
              JSON.stringify([
                { reaction: "0️⃣", label: "Our conversation about reporting" },
                {
                  reaction: "2️⃣",
                  label:
                    "We lose a whole day every week just pulling these reports together",
                },
              ]),
            "crm-action:v1:11111111-1111-4111-8111-111111111111:followup_quote_select:2099-01-01T00:00:00Z",
          ].join("\n"),
        }),
      { pubkey: TEST_IDENTITIES.alice.pubkey },
    );
    await page.setViewportSize({ width, height: 1000 });
    const card = page.getByTestId("crm-followup-quote-select");
    await expect(card).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "general",
              kind: 7,
            }) ?? false,
        ),
      )
      .toBe(true);
    // An arbitrary signed reaction not offered by this sparse card must not
    // strand the valid controls or pretend the CRM accepted that choice.
    await page.evaluate(
      ({ pubkey }) =>
        window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
          channelName: "general",
          id: "e".repeat(64),
          pubkey,
          kind: 7,
          content: "1️⃣",
          extraTags: [["e", "c".repeat(64)]],
        }),
      { pubkey: TEST_IDENTITIES.tyler.pubkey },
    );
    await expect(
      card.getByRole("button", { name: /Prospect quote/ }),
    ).toBeEnabled();
    await expect(card.getByRole("status")).toContainText(
      "review the full email",
    );
    await expect(
      card.getByRole("button", { name: "Approve and send" }),
    ).toHaveCount(0);
    await waitForAnimations(page);
    await card.screenshot({
      path: testInfo.outputPath(`quote-choice-${width}.png`),
    });
    await card.getByRole("button", { name: /Prospect quote/ }).click();
    await expect(card.getByRole("status")).toContainText("Choice submitted");
    await expect(card.getByRole("status")).toContainText(
      "Nothing has been sent",
    );
    await expect(
      card.getByRole("button", { name: /Classic subject/ }),
    ).toBeDisabled();
    await waitForAnimations(page);
    await card.screenshot({
      path: testInfo.outputPath(`quote-submitted-${width}.png`),
    });
  });
}
