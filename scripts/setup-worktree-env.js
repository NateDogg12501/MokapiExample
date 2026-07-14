#!/usr/bin/env node
// Auto-assigns non-colliding host ports for this checkout's .env so that
// multiple git worktrees of this repo can each run `docker compose up`
// at the same time. See "Working from multiple git worktrees" in README.md.
//
// How it decides ports: lists all worktrees for this repo and finds this
// checkout's position in that list. Position 0 (the primary checkout) keeps
// the default ports (3000/8080/8090). Every other position gets an offset
// of 20 * position added to each base port — big enough that no worktree's
// three ports can ever collide with another's.

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim()

const worktreePaths = execSync('git worktree list --porcelain')
    .toString()
    .trim()
    .split('\n\n')
    .map((block) => block.split('\n')[0].replace(/^worktree /, ''))
    .map((p) => path.resolve(p))

const index = worktreePaths.indexOf(path.resolve(repoRoot))
const offset = index > 0 ? index * 20 : 0

const ports = {
    BACKEND_PORT: 3000 + offset,
    MOKAPI_DASHBOARD_PORT: 8080 + offset,
    MOKAPI_API_PORT: 8090 + offset,
    MOKAPI_SMTP_PORT: 2525 + offset,
    LOCALSTACK_PORT: 4566 + offset
}

const envPath = path.join(repoRoot, '.env')
const examplePath = path.join(repoRoot, '.env.example')

let envContent = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8')
    : fs.readFileSync(examplePath, 'utf8')

for (const [key, value] of Object.entries(ports)) {
    const re = new RegExp(`^#?${key}=.*$`, 'm')
    const line = `${key}=${value}`
    envContent = re.test(envContent) ? envContent.replace(re, line) : `${envContent}\n${line}\n`
}

fs.writeFileSync(envPath, envContent)

if (offset > 0) {
    console.log(
        `Worktree detected (position ${index} of ${worktreePaths.length}) — ` +
        `assigned ports backend=${ports.BACKEND_PORT}, dashboard=${ports.MOKAPI_DASHBOARD_PORT}, ` +
        `mock=${ports.MOKAPI_API_PORT}, smtp=${ports.MOKAPI_SMTP_PORT}, localstack=${ports.LOCALSTACK_PORT} in .env`
    )
} else {
    console.log(`Primary checkout — using default ports backend=${ports.BACKEND_PORT}, dashboard=${ports.MOKAPI_DASHBOARD_PORT}, mock=${ports.MOKAPI_API_PORT}, smtp=${ports.MOKAPI_SMTP_PORT}, localstack=${ports.LOCALSTACK_PORT} in .env`)
}
