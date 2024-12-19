#!/usr/bin/env node

import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import {PNG} from "pngjs";
import pixelmatch from "pixelmatch";

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extractFrames = (videoPath, outputDir, frameCount) => {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        ffmpeg(videoPath)
            .on('end', () => {
                const files = fs
                    .readdirSync(outputDir)
                    .filter((file) => file.endsWith('.png'))
                    .sort();
                resolve(files.map((file) => path.join(outputDir, file)));
            })
            .on('error', reject)
            .outputOptions([
                '-vf',
                `select=not(mod(n\\,${Math.floor(100 / frameCount)}))`,
                '-vsync',
                'vfr',
                '-q:v',
                '2',
            ])
            .output(path.join(outputDir, 'frame_%03d.png'))
            .run();
    });
};

const compareFrames = (framesA, framesB) => {
    if (framesA.length !== framesB.length) {
        throw new Error('Frame counts do not match.');
    }

    let totalPixels = 0;
    let diffPixels = 0;

    framesA.forEach((frameAPath, index) => {
        const frameBPath = framesB[index];
        const imgA = PNG.sync.read(fs.readFileSync(frameAPath));
        const imgB = PNG.sync.read(fs.readFileSync(frameBPath));

        if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
            throw new Error('Frame dimensions do not match.');
        }

        const { width, height } = imgA;
        const diff = new PNG({ width, height });

        diffPixels += pixelmatch(imgA.data, imgB.data, diff.data, width, height, {
            threshold: 0.1,
        });
        totalPixels += width * height;
    });

    return (diffPixels / totalPixels) * 100;
};

const main = async () => {
    const args = process.argv.slice(2);

    if (args.length !== 2) {
        console.error('Usage: node compare.js <movie1> <movie2>');
        process.exit(1);
    }

    const [videoPathA, videoPathB] = args;

    const tempDirA = path.join(__dirname, 'tempA');
    const tempDirB = path.join(__dirname, 'tempB');

    try {
        console.log('Extracting frames from the first video...');
        const framesA = await extractFrames(videoPathA, tempDirA, 10);

        console.log('Extracting frames from the second video...');
        const framesB = await extractFrames(videoPathB, tempDirB, 10);

        console.log('Comparing frames...');
        const diffPercentage = compareFrames(framesA, framesB);

        console.log(`Difference: ${diffPercentage.toFixed(2)}%`);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        fs.rmSync(tempDirA, { recursive: true, force: true });
        fs.rmSync(tempDirB, { recursive: true, force: true });
    }
};

main();
