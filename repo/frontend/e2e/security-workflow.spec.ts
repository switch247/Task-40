import { expect, test } from "@playwright/test";

test("security page loads account security section with username and MFA status", async ({ page }) => {
  await page.route("**/api/v*/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.endsWith("/auth/me")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ userId: "u-editor", username: "editor", roles: ["editor"], permissions: ["stories.review"], mfaEnabled: false })
      });
      return;
    }
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "csrf-sec" }) });
      return;
    }
    if (path.endsWith("/alerts/dashboard")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [], banners: [], status: { queueDepth: 0 } }) });
      return;
    }
    await route.fulfill({ status: 404, body: "not mocked" });
  });

  await page.goto("/security");
  await expect(page.getByRole("heading", { name: "Security Settings" })).toBeVisible();
  await expect(page.getByText("User: editor")).toBeVisible();
  await expect(page.getByText("MFA Status: Not enabled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Enroll MFA" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Verify and Enable MFA" })).toBeVisible();
});

test("security page verify MFA button is disabled until 6-digit code entered", async ({ page }) => {
  await page.route("**/api/v*/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/auth/me")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: "u-editor", username: "editor", roles: ["editor"], permissions: ["stories.review"], mfaEnabled: false }) });
      return;
    }
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "csrf-sec" }) });
      return;
    }
    if (path.endsWith("/alerts/dashboard")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [], banners: [], status: { queueDepth: 0 } }) });
      return;
    }
    await route.fulfill({ status: 404, body: "not mocked" });
  });

  await page.goto("/security");
  const verifyBtn = page.getByRole("button", { name: "Verify and Enable MFA" });
  await expect(verifyBtn).toBeDisabled();

  await page.getByPlaceholder("123456").fill("12345");
  await expect(verifyBtn).toBeDisabled();

  await page.getByPlaceholder("123456").fill("123456");
  await expect(verifyBtn).toBeEnabled();
});

test("security page enroll MFA button shows provisioning URI after enrollment", async ({ page }) => {
  await page.route("**/api/v*/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (path.endsWith("/auth/me")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: "u-editor", username: "editor", roles: ["editor"], permissions: ["stories.review"], mfaEnabled: false }) });
      return;
    }
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "csrf-sec" }) });
      return;
    }
    if (path.endsWith("/alerts/dashboard")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [], banners: [], status: { queueDepth: 0 } }) });
      return;
    }
    if (path.endsWith("/auth/mfa/enroll") && req.method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ otpauth: "otpauth://totp/SentinelDesk:editor?secret=JBSWY3DPEHPK3PXP&issuer=SentinelDesk" })
      });
      return;
    }
    await route.fulfill({ status: 404, body: "not mocked" });
  });

  await page.goto("/security");
  await page.getByRole("button", { name: "Enroll MFA" }).click();

  await expect(page.getByText("Enrollment secret generated")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Authenticator Provisioning URI" })).toBeVisible();
  await expect(page.locator("textarea[readonly]")).toContainText("otpauth://totp/");
});

test("security page verify MFA submits code and shows success", async ({ page }) => {
  await page.route("**/api/v*/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (path.endsWith("/auth/me")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: "u-editor", username: "editor", roles: ["editor"], permissions: ["stories.review"], mfaEnabled: false }) });
      return;
    }
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "csrf-sec" }) });
      return;
    }
    if (path.endsWith("/alerts/dashboard")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [], banners: [], status: { queueDepth: 0 } }) });
      return;
    }
    if (path.endsWith("/auth/mfa/verify") && req.method() === "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
  });

  await page.goto("/security");
  await page.getByPlaceholder("123456").fill("654321");
  await page.getByRole("button", { name: "Verify and Enable MFA" }).click();

  await expect(page.getByText("MFA enabled successfully.")).toBeVisible();
});

test("security page shows MFA enabled status when mfaEnabled is true", async ({ page }) => {
  await page.route("**/api/v*/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/auth/me")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ userId: "u-editor", username: "editor", roles: ["editor"], permissions: ["stories.review"], mfaEnabled: true }) });
      return;
    }
    if (path.endsWith("/auth/csrf")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "csrf-sec" }) });
      return;
    }
    if (path.endsWith("/alerts/dashboard")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ alerts: [], banners: [], status: { queueDepth: 0 } }) });
      return;
    }
    await route.fulfill({ status: 404, body: "not mocked" });
  });

  await page.goto("/security");
  await expect(page.getByText("MFA Status: Enabled")).toBeVisible();
});
