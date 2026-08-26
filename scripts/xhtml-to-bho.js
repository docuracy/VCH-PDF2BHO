#!/usr/bin/env node
/**
 * Batch "Save as BHO XML" - the same two-stage transform the editor performs, run offline.
 *
 *   node scripts/xhtml-to-bho.js [-o OUTDIR] <file|dir> ...
 *
 * Accepts either:
 *   - VCH XHTML (an <article> document, i.e. what "Save as XHTML" writes), which is run through
 *     both stages: xhtml.sef.json -> BHO HTML -> html-to-bho.sef.json -> BHO XML; or
 *   - BHO HTML (what "Save as HTML" writes), which needs the second stage only.
 *
 * Files that are already BHO XML (a <report> root) are reported and skipped, so a mixed folder
 * can be pointed at this script safely.
 *
 * The compiled .sef.json stylesheets are used rather than the .xsl sources, so the output is
 * identical to the browser's. Requires network access on first run to fetch `xslt3` via npx.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');

const XSL_DIR = path.join(__dirname, '..', 'xhtml-view', 'xsl');
const STAGE1_SEF = path.join(XSL_DIR, 'xhtml.sef.json');
const STAGE2_SEF = path.join(XSL_DIR, 'html-to-bho.sef.json');

function saxon(sef, inFile, outFile) {
    execFileSync('npx', ['--yes', 'xslt3', `-s:${inFile}`, `-xsl:${sef}`, `-o:${outFile}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
    });
}

/**
 * Mirror the clean-up convertToBHO() applies to the serialised preview DOM, so that the BHO HTML
 * produced by stage 1 (or saved from the Preview tab) parses as well-formed XML for stage 2.
 */
function htmlToWellFormedXml(html) {
    return html
        .replace(/^﻿/, '')
        .replace(/<\?xml[^?]*\?>\s*/i, '')
        .replace(/<!DOCTYPE[^>]*>\s*/i, '')
        .replace(/\sxmlns="[^"]*"/g, '')
        .replace(/\sxmlns:[^=]+="[^"]*"/g, '')
        .replace(/<html[^>]*>/i, '<html>')
        .replace(/<(link|meta|br|hr|img|input|col|source)([^>]*?)(?<!\/)>/gi, '<$1$2/>');
}

/**
 * Stage 1 wraps its output in <article> too, so the presence of <article> cannot distinguish the
 * two inputs. What is distinctive is the markup only stage 1 emits: page breaks become
 * <p class="page-break">[Page N]</p> (the source uses <hr class="page-break"/>), the article
 * carries role="article", and footnotes become <a class="footnote">.
 */
function classify(text) {
    if (/<report[\s>]/.test(text)) return 'bho-xml';

    const stage1Markers = [
        /<p[^>]*\bclass="page-break"/i,
        /<article[^>]*\brole="article"/i,
        /<a[^>]*\bclass="footnote"/i,
    ].filter(re => re.test(text)).length;

    if (stage1Markers > 0) return 'bho-html';
    if (/<article[\s>]/.test(text)) return 'xhtml';
    return 'unknown';
}

function convert(inFile, outDir, tmpDir) {
    const base = path.basename(inFile).replace(/\.(xhtml|xml|html?|txt)$/i, '');
    const text = fs.readFileSync(inFile, 'utf8');
    const kind = classify(text);

    if (kind === 'bho-xml') return {file: inFile, status: 'skipped', note: 'already BHO XML'};
    if (kind === 'unknown') return {file: inFile, status: 'skipped', note: 'not XHTML or BHO HTML'};

    let bhoHtml;
    if (kind === 'xhtml') {
        const stage1Out = path.join(tmpDir, `${base}.stage1.html`);
        saxon(STAGE1_SEF, inFile, stage1Out);
        bhoHtml = fs.readFileSync(stage1Out, 'utf8');
    } else {
        bhoHtml = text;
    }

    const cleaned = path.join(tmpDir, `${base}.clean.xml`);
    fs.writeFileSync(cleaned, htmlToWellFormedXml(bhoHtml));

    const outFile = path.join(outDir, `${base}.xml`);
    saxon(STAGE2_SEF, cleaned, outFile);

    const result = fs.readFileSync(outFile, 'utf8');
    if (!/<report[\s>]/.test(result)) {
        fs.unlinkSync(outFile);
        return {file: inFile, status: 'failed', note: 'transform produced no <report> element'};
    }

    const figures = (result.match(/<figure[\s>]/g) || []).length;
    return {file: inFile, status: 'converted', note: `${figures} figure(s) -> ${path.basename(outFile)}`};
}

function collect(target) {
    const st = fs.statSync(target);
    if (!st.isDirectory()) return [target];
    return fs.readdirSync(target)
        .filter(f => /\.(xhtml|xml|html?)$/i.test(f))
        .map(f => path.join(target, f))
        .sort();
}

function main() {
    const argv = process.argv.slice(2);
    let outDir = process.cwd();
    const targets = [];

    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '-o' || argv[i] === '--out') outDir = argv[++i];
        else targets.push(argv[i]);
    }

    if (!targets.length) {
        console.error('Usage: node scripts/xhtml-to-bho.js [-o OUTDIR] <file|dir> ...');
        process.exit(1);
    }

    for (const sef of [STAGE1_SEF, STAGE2_SEF]) {
        if (!fs.existsSync(sef)) {
            console.error(`Missing compiled stylesheet: ${sef}\nRebuild it with npx xslt3 -export.`);
            process.exit(1);
        }
    }

    fs.mkdirSync(outDir, {recursive: true});
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bho-'));
    const results = [];

    for (const target of targets) {
        for (const file of collect(target)) {
            process.stderr.write(`  ${path.basename(file)} ... `);
            try {
                const r = convert(file, outDir, tmpDir);
                results.push(r);
                console.error(`${r.status}${r.note ? ` (${r.note})` : ''}`);
            } catch (e) {
                results.push({file, status: 'failed', note: e.message.split('\n')[0]});
                console.error(`failed (${e.message.split('\n')[0]})`);
            }
        }
    }

    fs.rmSync(tmpDir, {recursive: true, force: true});

    const tally = results.reduce((a, r) => ({...a, [r.status]: (a[r.status] || 0) + 1}), {});
    console.error(`\n${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    if (tally.failed) process.exit(1);
}

main();
