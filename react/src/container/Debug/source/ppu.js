/*
JSNES, based on Jamie Sanders' vNES
Copyright (C) 2010 Ben Firshman

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

JSNES.PPU = function (nes) {
    this.nes = nes;

    // 设置调色板 PaletteTable，有颜色突出 emphasis
    this.emphTable = new Array(64);
    for (i = 0; i < 64; i++) {
        this.emphTable[i] = new Array(8);
    }
    this.currentEmph = 0;
    var curTable = [
        0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840,
        0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000,
        0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1,
        0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000,
        0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7,
        0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000,
        0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF,
        0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000
    ];
    var factor = [
        1.000, 1.000, 1.000,
        0.743, 0.915, 1.239,
        0.882, 1.086, 0.794,
        0.653, 0.980, 1.019,
        1.277, 102.6, 0.905,
        0.979, 0.908, 1.023,
        1.001, 0.987, 0.741,
        0.750, 0.750, 0.750
    ];
    for (var emph = 0; emph < 8; emph++) {
        for (i = 0; i < 64; i++) {
            rgb = curTable[i];
            r = Math.floor(((rgb >> 16) & 0xFF) * factor[emph * 3]);
            g = Math.floor(((rgb >> 8) & 0xFF) * factor[emph * 3 + 1]);
            b = Math.floor((rgb & 0xFF) * factor[emph * 3 + 2]);
            this.emphTable[i][emph] = (r << 16) | (g << 8) | (b);
        }
    }

    this.vramMem = new Uint8Array(new ArrayBuffer(0x4000)); // Video RAM
    this.spriteMem = new Uint8Array(new ArrayBuffer(0x100));
    this.firstWrite = 0;
    this.reset();
};

JSNES.PPU.prototype = {

    reset: function () {
        for (var i = 0; i < this.vramMem.length; i++) {
            this.vramMem[i] = 0;
        }
        for (var i = 0; i < this.spriteMem.length; i++) {
            this.spriteMem[i] = 0;
        }

        // VRAM I/O:
        this.vramAddress = null;
        this.vramTmpAddress = null;
        this.vramBufferedReadValue = 0;
        this.firstWrite = true;       // VRAM/Scroll Hi/Lo latch

        // SPR-RAM I/O:
        this.sramAddress = 0; // 8-bit only.

        this.currentMirroring = -1;
        this.requestEndFrame = false;
        this.nmiOk = false;
        this.dummyCycleToggle = false;
        this.validTileData = false;
        this.nmiCounter = 0;
        this.scanlineAlreadyRendered = null;

        // $2000: Control Flags Register 1:(D7-D0)
        this.f_execNmiOnVBlank = 0;  // D7: Execute NMI on VBlank. 0=disable, 1=enable
        // D6: PPU Master/Slave Selection (UNUSED)
        this.f_spriteSize = 0;       // D5: Sprite size. 0=8x8, 1=8x16
        this.f_bgPatternTable = 0;   // D4: Background Pattern Table address. 0=0x0000,1=0x1000
        this.f_spPatternTable = 0;   // D3: Sprite Pattern Table address. 0=0x0000,1=0x1000
        this.f_addressIncrement = 0; // D2: PPU Address Increment. 0=1,1=32
        this.f_nameTableAddress = 0; // D1-D0: Name Table Address. 0=0x2000,1=0x2400,2=0x2800,3=0x2C00
        this.regV = 0; // D1
        this.regH = 0; // D0
        this.updateControlReg1 = function (value) {
            this.f_execNmiOnVBlank = (value >> 7) & 1;
            this.f_spriteSize = (value >> 5) & 1;
            this.f_bgPatternTable = (value >> 4) & 1;
            this.f_spPatternTable = (value >> 3) & 1;
            this.f_addressIncrement = (value >> 2) & 1;
            this.f_nameTableAddress = value & 3;
            this.regV = (value >> 1) & 1;
            this.regH = value & 1;
        };

        // $2001: Control Flags Register 2:
        this.f_color = 0;          // D7-D5: Full Background color (when D0 == 1) and Colour Intensity (when D0 == 0) . 0=black, 1=blue, 2=green, 4=red
        this.f_spVisibility = 0;   // D4: Sprite visibility. 0=not displayed,1=displayed
        this.f_bgVisibility = 0;   // D3: Background visibility. 0=Not Displayed,1=displayed
        this.f_spClipping = 0;     // D2: Sprite clipping. 0=Sprites invisible in left 8-pixel column,1=No clipping
        this.f_bgClipping = 0;     // D1: Background clipping. 0=BG invisible in left 8-pixel column, 1=No clipping
        this.f_dispType = 0;       // D0: Display type. 0=color, 1=monochrome
        this.updateControlReg2 = function (value) {
            this.f_color = (value >> 5) & 7;
            this.f_spVisibility = (value >> 4) & 1;
            this.f_bgVisibility = (value >> 3) & 1;
            this.f_spClipping = (value >> 2) & 1;
            this.f_bgClipping = (value >> 1) & 1;
            this.f_dispType = value & 1;
            if (this.f_dispType === 0) this.currentEmph = this.f_color;
            this.updatePalettes();
        };

        // $2002: PPU Status Register (R) 
        // Read the Status Register.
        this.STATUS_VBLANK = 7;
        this.STATUS_SPRITE0HIT = 6;
        this.STATUS_SLSPRITECOUNT = 5;
        this.STATUS_VRAMWRITE = 4;
        this.setStatusFlag = function (flag, value) {
            var n = 1 << flag;
            this.nes.cpu.mem[0x2002] =
                ((this.nes.cpu.mem[0x2002] & (255 - n)) | (value ? n : 0));
        };
        this.readStatusRegister = function () {
            var tmp = this.nes.cpu.mem[0x2002];
            this.firstWrite = true;// Reset scroll & VRAM Address toggle
            this.setStatusFlag(this.STATUS_VBLANK, false);// Clear VBlank flag
            return tmp;
        };

        // $2003: SPR-RAM Address Register (W)   
        // Write the SPR-RAM address that is used for sramWrite (Register 0x2004 in CPU memory map)
        this.sramAddress = 0;
        this.writeSRAMAddress = function (address) {
            this.sramAddress = address;
        };

        // $2004 (R): Read from SPR-RAM (Sprite RAM).
        // The address should be set first.
        this.sramLoad = function () {
            return this.spriteMem[this.sramAddress];
        };

        // $2004 (W): Write to SPR-RAM (Sprite RAM).
        // The address should be set first.
        this.sramWrite = function (value) {
            this.spriteMem[this.sramAddress] = value;
            this.spriteRamWriteUpdate(this.sramAddress, value);
            this.sramAddress++; // Increment address
            this.sramAddress %= 0x100;
        };

        // Counters:
        this.cntFV = 0;
        this.cntVT = 0;
        this.cntV = 0;
        this.cntH = 0;
        this.cntHT = 0;

        // $2005: Write to scroll registers. The first write is the vertical offset, the second is the horizontal offset:
        this.regVT = 0;
        this.regFV = 0;
        this.regHT = 0;
        this.regFH = 0;
        this.scrollWrite = function (value) {
            if (this.firstWrite) { // First write, horizontal scroll:
                this.regHT = (value >> 3) & 31;
                this.regFH = value & 7;
            } else { // Second write, vertical scroll:
                this.regVT = (value >> 3) & 31;
                this.regFV = value & 7;
            }
            this.firstWrite = !this.firstWrite;
        };
        // These are temporary variables used in rendering and sound procedures.
        // Their states outside of those procedures can be ignored.
        // TODO: the use of this is a bit weird, investigate
        this.curNt = null;

        // Variables used when rendering:
        this.attrib = new Array(32);
        this.buffer = new Uint8Array(new ArrayBuffer(256 * 240));
        this.bgbuffer = new Uint8Array(new ArrayBuffer(256 * 240));
        this.pixrendered = new Array(256 * 240);

        this.validTileData = null;

        this.scantile = new Array(32);

        // Initialize misc vars:
        this.scanline = 0;
        this.lastRenderedScanline = -1;
        this.curX = 0;

        // Sprite data:
        this.sprX = new Array(64); // X coordinate
        this.sprY = new Array(64); // Y coordinate
        this.sprTile = new Array(64); // Tile Index (into pattern table)
        this.sprCol = new Array(64); // Upper two bits of color
        this.vertFlip = new Array(64); // Vertical Flip
        this.horiFlip = new Array(64); // Horizontal Flip
        this.bgPriority = new Array(64); // Background priority
        this.spr0HitX = 0; // Sprite #0 hit X coordinate
        this.spr0HitY = 0; // Sprite #0 hit Y coordinate
        this.hitSpr0 = false;

        // Palette data:
        this.sprPalette = new Array(16);
        this.imgPalette = new Array(16);

        // Create pattern table tile buffers:
        this.ptTile = new Array(512);
        for (i = 0; i < 512; i++) {
            this.ptTile[i] = new JSNES.PPU.Tile();
        }

        // Create nametable buffers:
        // Name table data:
        this.ntable1 = new Array(4);
        this.currentMirroring = -1;
        this.nameTable = new Array(4);
        for (i = 0; i < 4; i++) {
            this.nameTable[i] = new JSNES.PPU.NameTable(32, 32, "Nt" + i);
        }

        // Initialize mirroring lookup table:
        this.vramMirrorTable = new Array(0x8000);
        for (i = 0; i < 0x8000; i++) {
            this.vramMirrorTable[i] = i;
        }
        this.updateControlReg1(0);
        this.updateControlReg2(0);
    },

    getColor: function (yiq) {
        return this.emphTable[yiq][this.currentEmph];
    },

    getimgPalette: function (i) {
        return this.vramMem[0x3f00 + i] & 0b11111111;
    },

    getsprPalette: function (i) {
        return this.vramMem[0x3f10 + i] & 0b11111111;
    },

    lower2bitColorIndexFromPatternTable: function (tIndex, x, y) {
        var vramIndex = tIndex * 8 * 2 + y;
        // console.log(vramIndex)
        var bitOffset = 7 - x;
        return ((this.vramMem[vramIndex] >> bitOffset) & 1) |
            (((this.vramMem[vramIndex + 8] >> bitOffset) & 1) << 1)
    },

    tileIndexFromNameTable: function (nameTableIndex, tileOffset) {
        // 0 <= tileOffset < 32*30=960
        return this.vramMem[0x2000 + nameTableIndex * 0x400 + tileOffset];
    },

    higher2bitColorIndexFromAttributeTable: function (attributeTableIndex, tileOffset) {
        var bitx = tileOffset & 0b10;
        var bity = (tileOffset >> 4) & 0b100;
        var bitOffset = bity | bitx; // bitOffset: 0 2 4 6

        var offsetx = (tileOffset >> 2) & 0b111;
        var offsety = (tileOffset >> 7) << 3;
        var offset = offsety | offsetx;

        // console.log(tileOffset.toString(16) + ":" + bitOffset.toString(16) + "," + offset.toString(16))
        return (
            (this.vramMem[0x23c0 + attributeTableIndex * 0x400 + offset]
                >> bitOffset
            ) & 0b11
        ) << 2;
    },

    // Sets Nametable mirroring.
    setMirroring: function (mirroring) {

        if (mirroring == this.currentMirroring) {
            return;
        }

        this.currentMirroring = mirroring;
        this.triggerRendering();

        // Remove mirroring:
        if (this.vramMirrorTable === null) {
            this.vramMirrorTable = new Array(0x8000);
        }
        for (var i = 0; i < 0x8000; i++) {
            this.vramMirrorTable[i] = i;
        }

        // Palette mirroring:
        this.defineMirrorRegion(0x3f20, 0x3f00, 0x20);
        this.defineMirrorRegion(0x3f40, 0x3f00, 0x20);
        this.defineMirrorRegion(0x3f80, 0x3f00, 0x20);
        this.defineMirrorRegion(0x3fc0, 0x3f00, 0x20);

        // Additional mirroring:
        this.defineMirrorRegion(0x3000, 0x2000, 0xf00);
        this.defineMirrorRegion(0x4000, 0x0000, 0x4000);

        if (mirroring == this.nes.rom.HORIZONTAL_MIRRORING) {
            console.log(1);
            this.ntable1[0] = 0;
            this.ntable1[1] = 0;
            this.ntable1[2] = 1;
            this.ntable1[3] = 1;
        } else if (mirroring == this.nes.rom.VERTICAL_MIRRORING) {
            console.log(2);
            this.ntable1[0] = 0;
            this.ntable1[1] = 1;
            this.ntable1[2] = 0;
            this.ntable1[3] = 1;
        } else if (mirroring == this.nes.rom.SINGLESCREEN_MIRRORING) {
            console.log(3);
            this.ntable1[0] = 0;
            this.ntable1[1] = 0;
            this.ntable1[2] = 0;
            this.ntable1[3] = 0;
        } else if (mirroring == this.nes.rom.SINGLESCREEN_MIRRORING2) {
            console.log(4);
            this.ntable1[0] = 1;
            this.ntable1[1] = 1;
            this.ntable1[2] = 1;
            this.ntable1[3] = 1;
        } else { // Assume Four-screen mirroring.
            console.log(5);
            this.ntable1[0] = 0;
            this.ntable1[1] = 1;
            this.ntable1[2] = 2;
            this.ntable1[3] = 3;
        }
    },


    // Define a mirrored area in the address lookup table.
    // Assumes the regions don't overlap.
    // The 'to' region is the region that is physically in memory.
    defineMirrorRegion: function (fromStart, toStart, size) {
        for (var i = 0; i < size; i++) {
            this.vramMirrorTable[fromStart + i] = toStart + i;
        }
    },

    startVBlank: function () {

        // Do NMI:
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NMI);

        // Make sure everything is rendered:
        if (this.lastRenderedScanline < 239) {
            this.renderFramePartially(
                this.lastRenderedScanline + 1, 240 - this.lastRenderedScanline
            );
        }

        if (this.nes.opts.showDisplay) {
            this.nes.ui.writeFrame(this.buffer);
        }

        // Reset scanline counter:
        this.lastRenderedScanline = -1;
    },

    endScanline: function () {
        switch (this.scanline) {
            case 19:
                // Dummy scanline.
                // May be variable length:
                if (this.dummyCycleToggle) {

                    // Remove dead cycle at end of scanline,
                    // for next scanline:
                    this.curX = 1;
                    this.dummyCycleToggle = !this.dummyCycleToggle;

                }
                break;

            case 20:
                // Clear VBlank flag:
                this.setStatusFlag(this.STATUS_VBLANK, false);

                // Clear Sprite #0 hit flag:
                this.setStatusFlag(this.STATUS_SPRITE0HIT, false);
                this.hitSpr0 = false;
                this.spr0HitX = -1;
                this.spr0HitY = -1;

                if (this.f_bgVisibility == 1 || this.f_spVisibility == 1) {

                    // Update counters:
                    this.cntFV = this.regFV;
                    this.cntV = this.regV;
                    this.cntH = this.regH;
                    this.cntVT = this.regVT;
                    this.cntHT = this.regHT;

                    if (this.f_bgVisibility == 1) {
                        // Render dummy scanline:
                        this.renderBgScanline(false, 0);
                    }

                }

                if (this.f_bgVisibility == 1 && this.f_spVisibility == 1) {

                    // Check sprite 0 hit for first scanline:
                    this.checkSprite0(0);

                }

                if (this.f_bgVisibility == 1 || this.f_spVisibility == 1) {
                    // Clock mapper IRQ Counter:
                    this.nes.mmap.clockIrqCounter();
                }
                break;

            case 261:
                // Dead scanline, no rendering.
                // Set VINT:
                this.setStatusFlag(this.STATUS_VBLANK, true);
                this.requestEndFrame = true;
                this.nmiCounter = 9;

                // Wrap around:
                this.scanline = -1; // will be incremented to 0

                break;

            default:
                if (this.scanline >= 21 && this.scanline <= 260) {

                    // Render normally:
                    if (this.f_bgVisibility == 1) {

                        if (!this.scanlineAlreadyRendered) {
                            // update scroll:
                            this.cntHT = this.regHT;
                            this.cntH = this.regH;
                            this.renderBgScanline(true, this.scanline + 1 - 21);
                        }
                        this.scanlineAlreadyRendered = false;

                        // Check for sprite 0 (next scanline):
                        if (!this.hitSpr0 && this.f_spVisibility == 1) {
                            if (this.sprX[0] >= -7 &&
                                this.sprX[0] < 256 &&
                                this.sprY[0] + 1 <= (this.scanline - 20) &&
                                (this.sprY[0] + 1 + (
                                    this.f_spriteSize === 0 ? 8 : 16
                                )) >= (this.scanline - 20)) {
                                if (this.checkSprite0(this.scanline - 20)) {
                                    this.hitSpr0 = true;
                                }
                            }
                        }

                    }

                    if (this.f_bgVisibility == 1 || this.f_spVisibility == 1) {
                        // Clock mapper IRQ Counter:
                        this.nes.mmap.clockIrqCounter();
                    }
                }
        }

        this.scanline++;
        this.regsToAddress();
        this.cntsToAddress();

    },

    startFrame: function () {
        // Set background color:
        var bgColor = 0;

        if (this.f_dispType === 0) {
            // Color display.
            // f_color determines color emphasis.
            // Use first entry of image palette as BG color.
            bgColor = this.imgPalette[0];
        } else {
            // Monochrome display.
            // f_color determines the bg color.
            switch (this.f_color) {
                case 0:
                    // Black
                    bgColor = 0x000000;
                    break;
                case 1:
                    // Green
                    bgColor = 0x00FF00;
                    break;
                case 2:
                    // Blue
                    bgColor = 0xFF0000;
                    break;
                case 3:
                    // Invalid. Use black.
                    bgColor = 0x000000;
                    break;
                case 4:
                    // Red
                    bgColor = 0x0000FF;
                    break;
                default:
                    // Invalid. Use black.
                    bgColor = 0x000000;
            }
        }

        var buffer = this.buffer;
        var i;

        for (i = 0; i < 256 * 240; i++) {
            buffer[i] = bgColor;
        }
        var pixrendered = this.pixrendered;
        for (i = 0; i < pixrendered.length; i++) {
            pixrendered[i] = 65;
        }
    },

    // CPU Register $2006:
    // Sets the adress used when reading/writing from/to VRAM.
    // The first write sets the high byte, the second the low byte.
    writeVRAMAddress: function (address) {

        if (this.firstWrite) {

            this.regFV = (address >> 4) & 3;
            this.regV = (address >> 3) & 1;
            this.regH = (address >> 2) & 1;
            this.regVT = (this.regVT & 7) | ((address & 3) << 3);

        } else {
            this.triggerRendering();

            this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
            this.regHT = address & 31;

            this.cntFV = this.regFV;
            this.cntV = this.regV;
            this.cntH = this.regH;
            this.cntVT = this.regVT;
            this.cntHT = this.regHT;

            this.checkSprite0(this.scanline - 20);

        }

        this.firstWrite = !this.firstWrite;

        // Invoke mapper latch:
        this.cntsToAddress();
        if (this.vramAddress < 0x2000) {
            this.nes.mmap.latchAccess(this.vramAddress);
        }
    },

    // CPU Register $2007(R):
    // Read from PPU memory. The address should be set first.
    vramLoad: function () {
        var tmp;

        this.cntsToAddress();
        this.regsToAddress();

        // If address is in range 0x0000-0x3EFF, return buffered values:
        if (this.vramAddress <= 0x3EFF) {
            tmp = this.vramBufferedReadValue;

            // Update buffered value:
            if (this.vramAddress < 0x2000) {
                this.vramBufferedReadValue = this.readMem(this.vramAddress);
            }
            else {
                this.vramBufferedReadValue = this.mirroredLoad(
                    this.vramAddress
                );
            }

            // Mapper latch access:
            if (this.vramAddress < 0x2000) {
                this.nes.mmap.latchAccess(this.vramAddress);
            }

            // Increment by either 1 or 32, depending on d2 of Control Register 1:
            this.vramAddress += (this.f_addressIncrement == 1 ? 32 : 1);

            this.cntsFromAddress();
            this.regsFromAddress();

            return tmp; // Return the previous buffered value.
        }

        // No buffering in this mem range. Read normally.
        tmp = this.mirroredLoad(this.vramAddress);

        // Increment by either 1 or 32, depending on d2 of Control Register 1:
        this.vramAddress += (this.f_addressIncrement == 1 ? 32 : 1);

        this.cntsFromAddress();
        this.regsFromAddress();

        return tmp;
    },

    // CPU Register $2007(W):
    // Write to PPU memory. The address should be set first.
    vramWrite: function (value) {

        this.triggerRendering();
        this.cntsToAddress();
        this.regsToAddress();

        if (this.vramAddress >= 0x2000) {
            // var address = this.vramAddress;
            // if (address >= 0x4000) {
            //     address &= 0x3fff;
            // }
            // if (address >= 0x3f20) {
            //     address &= 0x3f0f
            //     this.writeMem(address, value);
            //     this.writeMem(address+0x10, value);
            // } else if (address >= 0x3000 && address < 0x3f00) {
            //     address &= 0x2eff;
            //     this.writeMem(address, value);
            // } else {
            //     this.writeMem(address, value);
            // }
            this.mirroredWrite(this.vramAddress, value);
        } else {
            // Write normally.
            this.writeMem(this.vramAddress, value);
            // Invoke mapper latch:
            this.nes.mmap.latchAccess(this.vramAddress);
        }

        // Increment by either 1 or 32, depending on d2 of Control Register 1:
        this.vramAddress += (this.f_addressIncrement == 1 ? 32 : 1);
        this.regsFromAddress();
        this.cntsFromAddress();

    },

    // CPU Register $4014:
    // Write 256 bytes of main memory
    // into Sprite RAM.
    sramDMA: function (value) {
        var baseAddress = value * 0x100;
        var data;
        for (var i = this.sramAddress; i < 256; i++) {
            data = this.nes.cpu.mem[baseAddress + i];
            this.spriteMem[i] = data;
            this.spriteRamWriteUpdate(i, data);
        }

        this.nes.cpu.haltCycles(513);

    },

    // Updates the scroll registers from a new VRAM address.
    regsFromAddress: function () {

        var address = (this.vramTmpAddress >> 8) & 0xFF;
        this.regFV = (address >> 4) & 7;
        this.regV = (address >> 3) & 1;
        this.regH = (address >> 2) & 1;
        this.regVT = (this.regVT & 7) | ((address & 3) << 3);

        address = this.vramTmpAddress & 0xFF;
        this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
        this.regHT = address & 31;
    },

    // Updates the scroll registers from a new VRAM address.
    cntsFromAddress: function () {

        var address = (this.vramAddress >> 8) & 0xFF;
        this.cntFV = (address >> 4) & 3;
        this.cntV = (address >> 3) & 1;
        this.cntH = (address >> 2) & 1;
        this.cntVT = (this.cntVT & 7) | ((address & 3) << 3);

        address = this.vramAddress & 0xFF;
        this.cntVT = (this.cntVT & 24) | ((address >> 5) & 7);
        this.cntHT = address & 31;

    },

    regsToAddress: function () {
        var b1 = (this.regFV & 7) << 4;
        b1 |= (this.regV & 1) << 3;
        b1 |= (this.regH & 1) << 2;
        b1 |= (this.regVT >> 3) & 3;

        var b2 = (this.regVT & 7) << 5;
        b2 |= this.regHT & 31;

        this.vramTmpAddress = ((b1 << 8) | b2) & 0x7FFF;
    },

    cntsToAddress: function () {
        var b1 = (this.cntFV & 7) << 4;
        b1 |= (this.cntV & 1) << 3;
        b1 |= (this.cntH & 1) << 2;
        b1 |= (this.cntVT >> 3) & 3;

        var b2 = (this.cntVT & 7) << 5;
        b2 |= this.cntHT & 31;

        this.vramAddress = ((b1 << 8) | b2) & 0x7FFF;
    },

    // Reads from memory, taking into account
    // mirroring/mapping of address ranges.
    mirroredLoad: function (address) {
        return this.readMem(this.vramMirrorTable[address]);
    },

    // Writes to memory, taking into account
    // mirroring/mapping of address ranges.
    mirroredWrite: function (address, value) {
        if (address >= 0x3f00 && address < 0x3f20) {
            // Palette write mirroring.
            if (address == 0x3F00 || address == 0x3F10) {
                this.writeMem(0x3F00, value);
                this.writeMem(0x3F10, value);

            } else if (address == 0x3F04 || address == 0x3F14) {

                this.writeMem(0x3F04, value);
                this.writeMem(0x3F14, value);

            } else if (address == 0x3F08 || address == 0x3F18) {

                this.writeMem(0x3F08, value);
                this.writeMem(0x3F18, value);

            } else if (address == 0x3F0C || address == 0x3F1C) {

                this.writeMem(0x3F0C, value);
                this.writeMem(0x3F1C, value);

            } else {
                this.writeMem(address, value);
            }

        } else {

            // Use lookup table for mirrored address:
            if (address < this.vramMirrorTable.length) {
                this.writeMem(this.vramMirrorTable[address], value);
            } else {
                // FIXME
                alert("Invalid VRAM address: " + address.toString(16));
            }

        }
    },

    triggerRendering: function () {
        if (this.scanline >= 21 && this.scanline <= 260) {
            // Render sprites, and combine:
            this.renderFramePartially(
                this.lastRenderedScanline + 1,
                this.scanline - 21 - this.lastRenderedScanline
            );

            // Set last rendered scanline:
            this.lastRenderedScanline = this.scanline - 21;
        }
    },

    renderFramePartially: function (startScan, scanCount) {
        if (this.f_spVisibility == 1) {
            this.renderSpritesPartially(startScan, scanCount, true);
        }

        if (this.f_bgVisibility == 1) {
            var si = startScan << 8;
            var ei = (startScan + scanCount) << 8;
            if (ei > 0xF000) {
                ei = 0xF000;
            }
            var buffer = this.buffer;
            var bgbuffer = this.bgbuffer;
            var pixrendered = this.pixrendered;
            for (var destIndex = si; destIndex < ei; destIndex++) {
                if (pixrendered[destIndex] > 0xFF) {
                    buffer[destIndex] = bgbuffer[destIndex];
                }
            }
        }

        if (this.f_spVisibility == 1) {
            this.renderSpritesPartially(startScan, scanCount, false);
        }

        this.validTileData = false;
    },

    renderBgScanline: function (bgbuffer, scan) {
        var baseTile = (this.f_bgPatternTable === 0 ? 0 : 256);
        var destIndex = (scan << 8) - this.regFH;

        this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];

        this.cntHT = this.regHT;
        this.cntH = this.regH;
        this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];

        if (scan < 240 && (scan - this.cntFV) >= 0) {

            var tscanoffset = this.cntFV << 3;
            var scantile = this.scantile;
            var attrib = this.attrib;
            var ptTile = this.ptTile;
            var nameTable = this.nameTable;
            var pixrendered = this.pixrendered;
            var targetBuffer = bgbuffer ? this.bgbuffer : this.buffer;

            var t, tpix, att, col;

            for (var tile = 0; tile < 32; tile++) {

                if (scan >= 0) {

                    // Fetch tile & attrib data:
                    if (this.validTileData) {
                        // Get data from array:
                        t = scantile[tile];
                        if (typeof t === 'undefined') {
                            continue;
                        }
                        tpix = t.pix;
                        att = attrib[tile];
                    } else {
                        // Fetch data:
                        t = ptTile[baseTile + nameTable[this.curNt].tile[this.cntHT + 32 * this.cntVT]];
                        if (typeof t === 'undefined') {
                            continue;
                        }
                        tpix = t.pix;
                        att = nameTable[this.curNt].attrib[this.cntHT + 32 * this.cntVT];
                        scantile[tile] = t;
                        attrib[tile] = att;
                    }

                    // Render tile scanline:
                    var sx = 0;
                    var x = (tile << 3) - this.regFH;

                    if (x > -8) {
                        if (x < 0) {
                            destIndex -= x;
                            sx = -x;
                        }
                        if (t.opaque[this.cntFV]) {
                            for (; sx < 8; sx++) {
                                targetBuffer[destIndex] = this.imgPalette[tpix[tscanoffset + sx] + att];
                                pixrendered[destIndex] |= 256;
                                destIndex++;
                            }
                        } else {
                            for (; sx < 8; sx++) {
                                col = tpix[tscanoffset + sx];
                                if (col !== 0) {
                                    targetBuffer[destIndex] = this.imgPalette[col + att];
                                    pixrendered[destIndex] |= 256;
                                }
                                destIndex++;
                            }
                        }
                    }

                }

                // Increase Horizontal Tile Counter:
                if (++this.cntHT == 32) {
                    this.cntHT = 0;
                    this.cntH++;
                    this.cntH %= 2;
                    this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
                }


            }

            // Tile data for one row should now have been fetched,
            // so the data in the array is valid.
            this.validTileData = true;

        }

        // update vertical scroll:
        this.cntFV++;
        if (this.cntFV == 8) {
            this.cntFV = 0;
            this.cntVT++;
            if (this.cntVT == 30) {
                this.cntVT = 0;
                this.cntV++;
                this.cntV %= 2;
                this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
            } else if (this.cntVT == 32) {
                this.cntVT = 0;
            }

            // Invalidate fetched data:
            this.validTileData = false;

        }
    },

    renderSpritesPartially: function (startscan, scancount, bgPri) {
        if (this.f_spVisibility === 1) {

            for (var i = 0; i < 64; i++) {
                if (this.bgPriority[i] == bgPri && this.sprX[i] >= 0 &&
                    this.sprX[i] < 256 && this.sprY[i] + 8 >= startscan &&
                    this.sprY[i] < startscan + scancount) {
                    // Show sprite.
                    if (this.f_spriteSize === 0) {
                        // 8x8 sprites

                        this.srcy1 = 0;
                        this.srcy2 = 8;

                        if (this.sprY[i] < startscan) {
                            this.srcy1 = startscan - this.sprY[i] - 1;
                        }

                        if (this.sprY[i] + 8 > startscan + scancount) {
                            this.srcy2 = startscan + scancount - this.sprY[i] + 1;
                        }

                        if (this.f_spPatternTable === 0) {
                            this.ptTile[this.sprTile[i]].render(this.buffer,
                                0, this.srcy1, 8, this.srcy2, this.sprX[i],
                                this.sprY[i] + 1, this.sprCol[i], this.sprPalette,
                                this.horiFlip[i], this.vertFlip[i], i,
                                this.pixrendered
                            );
                        } else {
                            this.ptTile[this.sprTile[i] + 256].render(this.buffer,
                                0, this.srcy1, 8, this.srcy2, this.sprX[i],
                                this.sprY[i] + 1, this.sprCol[i], this.sprPalette,
                                this.horiFlip[i], this.vertFlip[i], i,
                                this.pixrendered
                            );
                        }
                    } else {
                        // 8x16 sprites
                        var top = this.sprTile[i];
                        if ((top & 1) !== 0) {
                            top = this.sprTile[i] - 1 + 256;
                        }

                        var srcy1 = 0;
                        var srcy2 = 8;

                        if (this.sprY[i] < startscan) {
                            srcy1 = startscan - this.sprY[i] - 1;
                        }

                        if (this.sprY[i] + 8 > startscan + scancount) {
                            srcy2 = startscan + scancount - this.sprY[i];
                        }

                        this.ptTile[top + (this.vertFlip[i] ? 1 : 0)].render(
                            this.buffer,
                            0,
                            srcy1,
                            8,
                            srcy2,
                            this.sprX[i],
                            this.sprY[i] + 1,
                            this.sprCol[i],
                            this.sprPalette,
                            this.horiFlip[i],
                            this.vertFlip[i],
                            i,
                            this.pixrendered
                        );

                        srcy1 = 0;
                        srcy2 = 8;

                        if (this.sprY[i] + 8 < startscan) {
                            srcy1 = startscan - (this.sprY[i] + 8 + 1);
                        }

                        if (this.sprY[i] + 16 > startscan + scancount) {
                            srcy2 = startscan + scancount - (this.sprY[i] + 8);
                        }

                        this.ptTile[top + (this.vertFlip[i] ? 0 : 1)].render(
                            this.buffer,
                            0,
                            srcy1,
                            8,
                            srcy2,
                            this.sprX[i],
                            this.sprY[i] + 1 + 8,
                            this.sprCol[i],
                            this.sprPalette,
                            this.horiFlip[i],
                            this.vertFlip[i],
                            i,
                            this.pixrendered
                        );

                    }
                }
            }
        }
    },

    checkSprite0: function (scan) {

        this.spr0HitX = -1;
        this.spr0HitY = -1;

        var toffset;
        var tIndexAdd = (this.f_spPatternTable === 0 ? 0 : 256);
        var x, y, t, i;
        var bufferIndex;
        var col;
        var bgPri;

        x = this.sprX[0];
        y = this.sprY[0] + 1;

        if (this.f_spriteSize === 0) {
            // 8x8 sprites.

            // Check range:
            if (y <= scan && y + 8 > scan && x >= -7 && x < 256) {

                // Sprite is in range.
                // Draw scanline:
                t = this.ptTile[this.sprTile[0] + tIndexAdd];
                col = this.sprCol[0];
                bgPri = this.bgPriority[0];

                if (this.vertFlip[0]) {
                    toffset = 7 - (scan - y);
                }
                else {
                    toffset = scan - y;
                }
                toffset *= 8;

                bufferIndex = scan * 256 + x;
                if (this.horiFlip[0]) {
                    for (i = 7; i >= 0; i--) {
                        if (x >= 0 && x < 256) {
                            if (bufferIndex >= 0 && bufferIndex < 61440 &&
                                this.pixrendered[bufferIndex] !== 0) {
                                if (t.pix[toffset + i] !== 0) {
                                    this.spr0HitX = bufferIndex % 256;
                                    this.spr0HitY = scan;
                                    return true;
                                }
                            }
                        }
                        x++;
                        bufferIndex++;
                    }
                }
                else {
                    for (i = 0; i < 8; i++) {
                        if (x >= 0 && x < 256) {
                            if (bufferIndex >= 0 && bufferIndex < 61440 &&
                                this.pixrendered[bufferIndex] !== 0) {
                                if (t.pix[toffset + i] !== 0) {
                                    this.spr0HitX = bufferIndex % 256;
                                    this.spr0HitY = scan;
                                    return true;
                                }
                            }
                        }
                        x++;
                        bufferIndex++;
                    }
                }
            }
        }
        else {
            // 8x16 sprites:

            // Check range:
            if (y <= scan && y + 16 > scan && x >= -7 && x < 256) {
                // Sprite is in range.
                // Draw scanline:

                if (this.vertFlip[0]) {
                    toffset = 15 - (scan - y);
                } else {
                    toffset = scan - y;
                }

                if (toffset < 8) {
                    // first half of sprite.
                    t = this.ptTile[this.sprTile[0] + (this.vertFlip[0] ? 1 : 0) + ((this.sprTile[0] & 1) !== 0 ? 255 : 0)];
                } else {
                    // second half of sprite.
                    t = this.ptTile[this.sprTile[0] + (this.vertFlip[0] ? 0 : 1) + ((this.sprTile[0] & 1) !== 0 ? 255 : 0)];
                    if (this.vertFlip[0]) {
                        toffset = 15 - toffset;
                    }
                    else {
                        toffset -= 8;
                    }
                }
                toffset *= 8;
                col = this.sprCol[0];
                bgPri = this.bgPriority[0];

                bufferIndex = scan * 256 + x;
                if (this.horiFlip[0]) {
                    for (i = 7; i >= 0; i--) {
                        if (x >= 0 && x < 256) {
                            if (bufferIndex >= 0 && bufferIndex < 61440 && this.pixrendered[bufferIndex] !== 0) {
                                if (t.pix[toffset + i] !== 0) {
                                    this.spr0HitX = bufferIndex % 256;
                                    this.spr0HitY = scan;
                                    return true;
                                }
                            }
                        }
                        x++;
                        bufferIndex++;
                    }

                }
                else {

                    for (i = 0; i < 8; i++) {
                        if (x >= 0 && x < 256) {
                            if (bufferIndex >= 0 && bufferIndex < 61440 && this.pixrendered[bufferIndex] !== 0) {
                                if (t.pix[toffset + i] !== 0) {
                                    this.spr0HitX = bufferIndex % 256;
                                    this.spr0HitY = scan;
                                    return true;
                                }
                            }
                        }
                        x++;
                        bufferIndex++;
                    }

                }

            }

        }

        return false;
    },

    readMem: function (address) {
        address &= 0x3fff;
        if (address >= 0x3f20) {
            address &= 0x3f1f;
        } else if (address >= 0x3000 && address < 0x3f00) {
            address &= 0x2fff;
        }
        return this.vramMem[address];
    },

    // This will write to PPU memory, and
    // update internally buffered data
    // appropriately.
    writeMem: function (address, value) {
        this.vramMem[address] = value;

        // Update internally buffered data:
        if (address < 0x2000) {
            this.patternWrite(address, value);
        } else if (address >= 0x2000 && address < 0x23c0) {
            this.nameTableWrite(this.ntable1[0], address - 0x2000, value);
        } else if (address >= 0x23c0 && address < 0x2400) {
            this.attribTableWrite(this.ntable1[0], address - 0x23c0, value);
        } else if (address >= 0x2400 && address < 0x27c0) {
            this.nameTableWrite(this.ntable1[1], address - 0x2400, value);
        } else if (address >= 0x27c0 && address < 0x2800) {
            this.attribTableWrite(this.ntable1[1], address - 0x27c0, value);
        } else if (address >= 0x2800 && address < 0x2bc0) {
            this.nameTableWrite(this.ntable1[2], address - 0x2800, value);
        } else if (address >= 0x2bc0 && address < 0x2c00) {
            this.attribTableWrite(this.ntable1[2], address - 0x2bc0, value);
        } else if (address >= 0x2c00 && address < 0x2fc0) {
            this.nameTableWrite(this.ntable1[3], address - 0x2c00, value);
        } else if (address >= 0x2fc0 && address < 0x3000) {
            this.attribTableWrite(this.ntable1[3], address - 0x2fc0, value);
        } else if (address >= 0x3f00 && address < 0x3f20) {
            this.updatePalettes();
        }
    },

    // Reads data from $3f00 to $f20 
    // into the two buffered palettes.
    updatePalettes: function () {
        var i;
        for (i = 0; i < 16; i++) {
            if (this.f_dispType === 0) {
                this.imgPalette[i] = this.vramMem[0x3f00 + i] & 63;
            } else {
                this.imgPalette[i] = this.vramMem[0x3f00 + i] & 32;
            }
        }
        for (i = 0; i < 16; i++) {
            if (this.f_dispType === 0) {
                this.sprPalette[i] = this.readMem(0x3f10 + i) & 63;
            } else {
                this.sprPalette[i] = this.readMem(0x3f10 + i) & 32;
            }
        }
    },

    // Updates the internal pattern
    // table buffers with this new byte.
    // In vNES, there is a version of this with 4 arguments which isn't used.
    patternWrite: function (address, value) {
        var tileIndex = Math.floor(address / 16);
        var leftOver = address % 16;
        if (leftOver < 8) {
            this.ptTile[tileIndex].setScanline(
                leftOver,
                value,
                this.readMem(address + 8)
            );
        }
        else {
            this.ptTile[tileIndex].setScanline(
                leftOver - 8,
                this.readMem(address - 8),
                value
            );
        }
    },

    // Updates the internal name table buffers
    // with this new byte.
    nameTableWrite: function (index, address, value) {
        this.nameTable[index].tile[address] = value;

        // Update Sprite #0 hit:
        //updateSpr0Hit();
        this.checkSprite0(this.scanline - 20);
    },

    // Updates the internal pattern
    // table buffers with this new attribute
    // table byte.
    attribTableWrite: function (index, address, value) {
        this.nameTable[index].writeAttrib(address, value);
    },

    // Updates the internally buffered sprite
    // data with this new byte of info.
    spriteRamWriteUpdate: function (address, value) {
        var tIndex = Math.floor(address / 4);

        if (tIndex === 0) {
            //updateSpr0Hit();
            this.checkSprite0(this.scanline - 20);
        }

        if (address % 4 === 0) {
            // Y coordinate
            this.sprY[tIndex] = value;
        }
        else if (address % 4 == 1) {
            // Tile index
            this.sprTile[tIndex] = value;
        }
        else if (address % 4 == 2) {
            // Attributes
            this.vertFlip[tIndex] = ((value & 0x80) !== 0);
            this.horiFlip[tIndex] = ((value & 0x40) !== 0);
            this.bgPriority[tIndex] = ((value & 0x20) !== 0);
            this.sprCol[tIndex] = (value & 3) << 2;

        }
        else if (address % 4 == 3) {
            // X coordinate
            this.sprX[tIndex] = value;
        }
    },

    doNMI: function () {
        // Set VBlank flag:
        this.setStatusFlag(this.STATUS_VBLANK, true);
        //nes.getCpu().doNonMaskableInterrupt();
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NMI);
    },

    JSON_PROPERTIES: [
        // Memory
        'vramMem', 'spriteMem',
        // Counters
        'cntFV', 'cntV', 'cntH', 'cntVT', 'cntHT',
        // Registers
        'regFV', 'regV', 'regH', 'regVT', 'regHT', 'regFH', 'regS',
        // VRAM addr
        'vramAddress', 'vramTmpAddress',
        // Control/Status registers
        'f_execNmiOnVBlank', 'f_spriteSize', 'f_bgPatternTable', 'f_spPatternTable',
        'f_addressIncrement', 'f_nameTableAddress', 'f_color', 'f_spVisibility',
        'f_bgVisibility', 'f_spClipping', 'f_bgClipping', 'f_dispType',
        // VRAM I/O
        'vramBufferedReadValue', 'firstWrite',
        // Mirroring
        'currentMirroring', 'vramMirrorTable', 'ntable1',
        // SPR-RAM I/O
        'sramAddress',
        // Sprites. Most sprite data is rebuilt from spriteMem
        'hitSpr0',
        // Palettes
        'sprPalette',
        // Rendering progression
        'curX', 'scanline', 'lastRenderedScanline', 'curNt', 'scantile',
        // Used during rendering
        'attrib', 'buffer', 'bgbuffer', 'pixrendered',
        // Misc
        'requestEndFrame', 'nmiOk', 'dummyCycleToggle', 'nmiCounter',
        'validTileData', 'scanlineAlreadyRendered'
    ],

    toJSON: function () {
        var i;
        var state = JSNES.Utils.toJSON(this);

        state.nameTable = [];
        for (i = 0; i < this.nameTable.length; i++) {
            state.nameTable[i] = this.nameTable[i].toJSON();
        }

        state.ptTile = [];
        for (i = 0; i < this.ptTile.length; i++) {
            state.ptTile[i] = this.ptTile[i].toJSON();
        }

        return state;
    },

    fromJSON: function (state) {
        var i;

        JSNES.Utils.fromJSON(this, state);

        for (i = 0; i < this.nameTable.length; i++) {
            this.nameTable[i].fromJSON(state.nameTable[i]);
        }

        for (i = 0; i < this.ptTile.length; i++) {
            this.ptTile[i].fromJSON(state.ptTile[i]);
        }

        // Sprite data:
        for (i = 0; i < this.spriteMem.length; i++) {
            this.spriteRamWriteUpdate(i, this.spriteMem[i]);
        }
    }
};

JSNES.PPU.NameTable = function (width, height, name) {
    this.width = width;
    this.height = height;
    this.name = name;

    this.tile = new Array(width * height);
    this.attrib = new Array(width * height);
    for (i = 0; i < width * height; i++) {
        this.tile[i] = 0;
        this.attrib[i] = 0;
    }
};

JSNES.PPU.NameTable.prototype = {
    writeAttrib: function (index, value) {
        var basex = (index % 8) * 4;
        var basey = Math.floor(index / 8) * 4;
        var add;
        var tx, ty;
        var attindex;

        for (var sqy = 0; sqy < 2; sqy++) {
            for (var sqx = 0; sqx < 2; sqx++) {
                add = (value >> (2 * (sqy * 2 + sqx))) & 3;
                for (var y = 0; y < 2; y++) {
                    for (var x = 0; x < 2; x++) {
                        tx = basex + sqx * 2 + x;
                        ty = basey + sqy * 2 + y;
                        attindex = ty * this.width + tx;
                        this.attrib[ty * this.width + tx] = (add << 2) & 12;
                    }
                }
            }
        }
    },

    toJSON: function () {
        return {
            'tile': this.tile,
            'attrib': this.attrib
        };
    },

    fromJSON: function (s) {
        this.tile = s.tile;
        this.attrib = s.attrib;
    }
};

JSNES.PPU.Tile = function () {
    // Tile data:
    this.pix = new Array(64);
    this.opaque = new Array(8);
};

JSNES.PPU.Tile.prototype = {
    setBuffer: function (scanline) {
        for (var y = 0; y < 8; y++) {
            this.setScanline(y, scanline[y], scanline[y + 8]);
        }
    },

    setScanline: function (sline, b1, b2) {
        var tIndex = sline << 3;
        for (var x = 0; x < 8; x++) {
            this.pix[tIndex + x] = ((b1 >> (7 - x)) & 1) +
                (((b2 >> (7 - x)) & 1) << 1);
            if (this.pix[tIndex + x] === 0) {
                this.opaque[sline] = false;
            }
        }
    },

    render: function (buffer, srcx1, srcy1, srcx2, srcy2, dx, dy, palAdd, palette, flipHorizontal, flipVertical, pri, priTable) {
        if (dx < -7 || dx >= 256 || dy < -7 || dy >= 240) {
            return;
        }
        if (dx < 0) {
            srcx1 -= dx;
        }
        if (dx + srcx2 >= 256) {
            srcx2 = 256 - dx;
        }
        if (dy < 0) {
            srcy1 -= dy;
        }
        if (dy + srcy2 >= 240) {
            srcy2 = 240 - dy;
        }

        var fbIndex = (dy << 8) + dx;
        var tIndex = 0;
        if (!flipVertical && !flipHorizontal) {
            tIndex = 0;
        } else if (flipHorizontal && !flipVertical) {
            tIndex = 7;
        } else if (flipVertical && !flipHorizontal) {
            tIndex = 56;
        } else {
            tIndex = 63;
        }
        for (var y = 0; y < 8; y++) {
            for (var x = 0; x < 8; x++) {
                if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
                    var palIndex = this.pix[tIndex + (flipHorizontal ? -x : x)];
                    var tpri = priTable[fbIndex + x];
                    if (palIndex !== 0 && pri <= (tpri & 0xFF)) {
                        buffer[fbIndex + x] = palette[palIndex + palAdd];
                        tpri = (tpri & 0xF00) | pri;
                        priTable[fbIndex + x] = tpri;
                    }
                }
            }
            fbIndex += 256;
            tIndex += (flipVertical ? -8 : 8);
        }
    },

    toJSON: function () {
        return {
            'opaque': this.opaque,
            'pix': this.pix
        };
    },

    fromJSON: function (s) {
        this.opaque = s.opaque;
        this.pix = s.pix;
    }
};
