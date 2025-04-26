#!/bin/bash

# Package script for Solana Layer-2 Solution
# This script packages the Solana Layer-2 solution for deployment
# It creates a zip file containing all necessary files

# Set variables
OUTPUT_DIR="./dist"
PACKAGE_NAME="solana-layer2-solution"
VERSION="1.0.0"
TIMESTAMP=$(date +"%Y%m%d%H%M%S")
PACKAGE_FILENAME="${PACKAGE_NAME}-${VERSION}-${TIMESTAMP}.zip"

# Create output directory if it doesn't exist
mkdir -p $OUTPUT_DIR

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf $OUTPUT_DIR/*

# Compile TypeScript files
echo "Compiling TypeScript files..."
npm run build

# Create package structure
echo "Creating package structure..."
mkdir -p $OUTPUT_DIR/src
mkdir -p $OUTPUT_DIR/docs
mkdir -p $OUTPUT_DIR/config

# Copy files
echo "Copying files..."
cp -r ./build/* $OUTPUT_DIR/src/
cp -r ./docs/* $OUTPUT_DIR/docs/
cp package.json $OUTPUT_DIR/
cp README.md $OUTPUT_DIR/
cp -r ./config/* $OUTPUT_DIR/config/

# Create zip file
echo "Creating zip file..."
cd $OUTPUT_DIR
zip -r $PACKAGE_FILENAME *
cd ..

# Move zip file to output directory
echo "Moving zip file to output directory..."
mv $OUTPUT_DIR/$PACKAGE_FILENAME $OUTPUT_DIR/

echo "Package created successfully: $OUTPUT_DIR/$PACKAGE_FILENAME"
echo "Package size: $(du -h $OUTPUT_DIR/$PACKAGE_FILENAME | cut -f1)"

# Create checksum
echo "Creating checksum..."
sha256sum $OUTPUT_DIR/$PACKAGE_FILENAME > $OUTPUT_DIR/$PACKAGE_FILENAME.sha256

echo "Packaging complete!"
