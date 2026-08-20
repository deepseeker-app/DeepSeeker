# Agent Note: Built-in DeepSeek balance surface

Status: implemented

English | [中文](2026-08-16-deepseek-balance-surface.zh.md)

## Problem

DeepSeeker users could use the configured DeepSeek key without seeing whether the account still had funds. The reference plugin `cn-scuo-oo/dsh-deepseek-quota` demonstrated the useful placement, but it also presented local payment choices and a mount-relative usage number that were not backed by authoritative payment or usage data.

## Decision

`@deepseek-ai/dsh-client-ui-deepseek-balance` is a first-party dual-face plugin. Its Host half resolves `DEEPSEEK_API_KEY` per request, calls DeepSeek's official balance endpoint, validates documented money fields, and returns only a normalized record from `/deepseeker/deepseek-balance`. Missing, invalid, and temporarily unavailable states use stable codes in successful same-origin responses, so Chromium does not report renderable account states as failed resource loads. Credentials and upstream error bodies stay on the Host.

The browser half registers one `sidebar.footer.action` entry. The expanded card shows total, topped-up, and granted balances, polls every 60 seconds, prevents overlapping requests, and preserves stale data after a refresh failure. Its top-up action opens an in-app launcher containing a QR code and direct link for DeepSeek's official top-up page; payment details remain on DeepSeek. The collapsed entry expands the sidebar. A narrow-viewport inset keeps the controls away from the shipped desktop pet's right-side overlay area.

## Alternatives considered

**Install the reference package unchanged.** Rejected because its local amount and payment-method selections imply an order flow DeepSeeker does not own, while its “used” value measures only balance decrease since component mount. The official-page QR launcher remains useful without those pretend order controls.

**Call DeepSeek directly from the browser.** Rejected because that would expose the API key to browser code and developer tools.

## Consequences

The Web bundle and desktop dependency closure ship the same balance surface. The feature reports balance, not quota or billed usage. Top-up remains on DeepSeek's website, and the card has no authority to submit payments or alter credentials.
