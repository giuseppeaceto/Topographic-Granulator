const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const toIco = require('to-ico');

const logoPath = path.join(__dirname, '../public/icons/icon.png');
const outputPath = path.join(__dirname, '../build/icon.ico');
const tempDir = path.join(__dirname, '../build/temp-icons');

// Create temp directory
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Create different sizes for .ico (Windows needs 16, 32, 48, 256)
const sizes = [16, 32, 48, 256];
const pngFiles = [];

console.log('Creating icon sizes...');
sizes.forEach(size => {
  const outputFile = path.join(tempDir, `icon_${size}x${size}.png`);
  try {
    execSync(`sips -z ${size} ${size} "${logoPath}" --out "${outputFile}"`, { stdio: 'inherit' });
    pngFiles.push(fs.readFileSync(outputFile));
    console.log(`Created ${size}x${size} icon`);
  } catch (error) {
    console.error(`Error creating ${size}x${size} icon:`, error);
  }
});

// Convert PNGs to ICO
console.log('Converting to ICO format...');
toIco(pngFiles)
  .then(buf => {
    fs.writeFileSync(outputPath, buf);
    console.log(`Successfully created ${outputPath}`);
    
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('Cleanup complete');
  })
  .catch(error => {
    console.error('Error creating ICO:', error);
    process.exit(1);
  });

