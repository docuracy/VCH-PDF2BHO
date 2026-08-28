#!/usr/bin/env node
/**
 * Batch "Save as BHO XML" - the same two-stage transform the editor performs, run offline.
 *
 *   node scripts/xhtml-to-bho.js [-o OUTDIR] [--repair] [--no-validate] <file|dir> ...
 *
 * Accepts either:
 *   - VCH XHTML (an <article> document, i.e. what "Save as XHTML" writes), which is run through
 *     both stages: xhtml.sef.json -> BHO HTML -> html-to-bho.sef.json -> BHO XML; or
 *   - BHO HTML (what "Save as HTML" writes), which needs the second stage only.
 *
 * Files that are already BHO XML (a <report> root) are reported and skipped, so a mixed folder
 * can be pointed at this script safely. With --repair they are instead run through
 * bho-xml-repair.sef.json, which brings XML exported before the DTD was known up to standard.
 *
 * Output is validated against BHO's DTD (vendored in dtd/) when xmllint is on the PATH; pass
 * --no-validate to skip it. Validation failures are reported per file and set the exit status,
 * but the file is still written, so the errors can be inspected.
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
const REPAIR_SEF = path.join(XSL_DIR, 'bho-xml-repair.sef.json');
const DTD_DIR = path.join(__dirname, '..', 'dtd');

function saxon(sef, inFile, outFile) {
    execFileSync('npx', ['--yes', 'xslt3', `-s:${inFile}`, `-xsl:${sef}`, `-o:${outFile}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
    });
}

/**
 * An index volume transforms to an <index> root, which is a separate document type with its own
 * DTD - entry, key and sub are declared only there. XSLT 1.0 cannot vary xsl:output's
 * doctype-system, so the declaration is corrected here, exactly as convertToBHO() does in the
 * browser.
 */
function fixDoctype(xml) {
    if (!/<index[\s>]/.test(xml)) return xml;
    return xml.replace(/<!DOCTYPE\s+report\s+SYSTEM\s+"dtd\/report\.dtd">/,
                       '<!DOCTYPE index SYSTEM "dtd/index.dtd">');
}

let xmllintChecked = false;
let xmllintAvailable = false;

function haveXmllint() {
    if (!xmllintChecked) {
        xmllintChecked = true;
        try {
            execFileSync('xmllint', ['--version'], {stdio: 'ignore'});
            xmllintAvailable = true;
        } catch {
            xmllintAvailable = false;
        }
    }
    return xmllintAvailable;
}

/**
 * Validate against the vendored DTD. figure/@visible is honoured by BHO's stylesheet but is not
 * declared in report.dtd, so published files carry it too; it is the one error we discount.
 */
function validate(file) {
    if (!haveXmllint()) return null;
    const isIndex = /<index[\s>]/.test(fs.readFileSync(file, 'utf8'));
    const dtd = path.join(DTD_DIR, isIndex ? 'index.dtd' : 'report.dtd');
    try {
        execFileSync('xmllint', ['--noout', '--dtdvalid', dtd, file], {stdio: ['ignore', 'pipe', 'pipe']});
        return [];
    } catch (e) {
        return String(e.stderr || '')
            .split('\n')
            .filter(l => l.includes('validity error'))
            .filter(l => !l.includes('No declaration for attribute visible'))
            .map(l => l.replace(/^.*validity error : /, '').trim());
    }
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

function convert(inFile, outDir, tmpDir, opts) {
    const base = path.basename(inFile).replace(/\.(xhtml|xml|html?|txt)$/i, '');
    const text = fs.readFileSync(inFile, 'utf8');
    const kind = classify(text);

    if (kind === 'bho-xml') {
        if (!opts.repair) return {file: inFile, status: 'skipped', note: 'already BHO XML'};
        return repair(inFile, base, outDir, opts);
    }
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

    let result = fs.readFileSync(outFile, 'utf8');
    if (!/<(report|index)[\s>]/.test(result)) {
        fs.unlinkSync(outFile);
        return {file: inFile, status: 'failed', note: 'transform produced no <report> element'};
    }

    result = fixDoctype(result);
    fs.writeFileSync(outFile, result);

    const figures = (result.match(/<figure[\s>]/g) || []).length;
    return finish(inFile, outFile, `${figures} figure(s)`, opts);
}

/**
 * Bring BHO XML exported before the DTD was known up to standard. Used for files already
 * delivered as XML, whose VCH XHTML sources are no longer to hand.
 */
function repair(inFile, base, outDir, opts) {
    const outFile = path.join(outDir, `${base}.xml`);
    saxon(REPAIR_SEF, inFile, outFile);

    let result = fixDoctype(fs.readFileSync(outFile, 'utf8'));
    fs.writeFileSync(outFile, result);

    const root = /<index[\s>]/.test(result) ? 'index' : 'report';
    return finish(inFile, outFile, `repaired as <${root}>`, opts);
}

/**
 * Validate the written file, and fold the verdict into the result line.
 */
function finish(inFile, outFile, note, opts) {
    const errors = opts.validate ? validate(outFile) : null;
    if (errors === null) {
        return {file: inFile, status: 'converted', note: `${note} -> ${path.basename(outFile)}`};
    }
    if (errors.length) {
        return {
            file: inFile,
            status: 'invalid',
            note: `${note} -> ${path.basename(outFile)}; ${errors.length} validity error(s)`,
            errors,
        };
    }
    return {file: inFile, status: 'converted', note: `${note} -> ${path.basename(outFile)}, valid`};
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
    const opts = {repair: false, validate: true};

    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '-o' || argv[i] === '--out') outDir = argv[++i];
        else if (argv[i] === '--repair') opts.repair = true;
        else if (argv[i] === '--no-validate') opts.validate = false;
        else targets.push(argv[i]);
    }

    if (!targets.length) {
        console.error('Usage: node scripts/xhtml-to-bho.js [-o OUTDIR] [--repair] [--no-validate] <file|dir> ...');
        process.exit(1);
    }

    const needed = [STAGE1_SEF, STAGE2_SEF].concat(opts.repair ? [REPAIR_SEF] : []);
    for (const sef of needed) {
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
                const r = convert(file, outDir, tmpDir, opts);
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

    if (opts.validate && !haveXmllint()) {
        console.error('xmllint not found: output was not validated (install libxml2-utils, or pass --no-validate)');
    }

    const invalid = results.filter(r => r.status === 'invalid');
    if (invalid.length) {
        console.error('\nValidity errors:');
        for (const r of invalid) {
            console.error(`  ${path.basename(r.file)}`);
            const counted = r.errors.reduce((a, e) => ({...a, [e]: (a[e] || 0) + 1}), {});
            for (const [msg, n] of Object.entries(counted).slice(0, 5)) {
                console.error(`    ${n} x ${msg.slice(0, 140)}`);
            }
        }
    }

    if (tally.failed || invalid.length) process.exit(1);
}

main();
