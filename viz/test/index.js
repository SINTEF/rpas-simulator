// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Node >= 21 takes `node --test viz/test` as a file and resolves the directory to this index:
// run every *.test.js beside it.
import { readdirSync } from "node:fs";

for (const f of readdirSync(import.meta.dirname)) if (f.endsWith(".test.js")) await import(`./${f}`);
