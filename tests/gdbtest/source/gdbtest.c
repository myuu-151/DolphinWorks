// gdbtest: checks GDB on real hardware over the USB Gecko. Starts libogc's debug stub on the Gecko's slot and
// waits for GDB; then counts frames in count_frame() (a place to put a breakpoint). A: a deliberate crash
// (GDB should stop on the line that writes to NULL). B: break into GDB on purpose.
// Built -O0 (every line steppable) and linked with -ldb (the stub). Debug with the .elf, not the .dol.
#include <gccore.h>
#include <ogc/usbgecko.h>
#include <debug.h>
#include <stdio.h>
#include <stdlib.h>

static void *xfb;
static GXRModeObj *mode;

// read and changed from GDB: try "print frames", "print hp", "set var hp = 999"
volatile u32 frames = 0;
volatile int hp = 100;

static void video_init(void)
{
	VIDEO_Init();
	PAD_Init();
	mode = VIDEO_GetPreferredMode(NULL);
	xfb = MEM_K0_TO_K1(SYS_AllocateFramebuffer(mode));
	console_init(xfb, 20, 20, mode->fbWidth, mode->xfbHeight, mode->fbWidth * VI_DISPLAY_PIX_SZ);
	VIDEO_Configure(mode);
	VIDEO_SetNextFramebuffer(xfb);
	VIDEO_SetBlack(false);
	VIDEO_Flush();
	VIDEO_WaitVSync();
	if (mode->viTVMode & VI_NON_INTERLACE)
		VIDEO_WaitVSync();
}

// once a frame: "break count_frame" in GDB stops here every frame
void count_frame(void)
{
	frames++;
	if (frames % 60 == 0)
		hp = hp > 0 ? hp - 1 : 100;
}

// A: a deliberate crash. GDB should stop on the write below and show this function in "bt".
void crash_here(void)
{
	volatile int *nothing = NULL;
	printf("\x1b[14;0H  Crashing on purpose: GDB should stop here.          \n");
	*nothing = 42;
}

int main(void)
{
	video_init();
	printf("\x1b[2;0H");
	printf("  DolphinWorks GDB test\n\n");

	s32 chn = -1;
	if (usb_isgeckoalive(EXI_CHANNEL_0))
		chn = EXI_CHANNEL_0;
	else if (usb_isgeckoalive(EXI_CHANNEL_1))
		chn = EXI_CHANNEL_1;
	if (chn < 0)
	{
		printf("  No USB Gecko found in slot A or slot B.\n");
		printf("  Plug it into a memory card slot (A is best), then restart.\n\n");
		printf("  Press START to go back.\n");
		while (1)
		{
			VIDEO_WaitVSync();
			PAD_ScanPads();
			if (PAD_ButtonsDown(0) & PAD_BUTTON_START)
				exit(0);
		}
	}

	printf("  USB Gecko in slot %c. Waiting for GDB on the PC:\n\n", chn == EXI_CHANNEL_0 ? 'A' : 'B');
	printf("    powerpc-eabi-gdb gdbtest.elf\n");
	printf("    (gdb) target remote \\\\.\\COM3   (the Gecko's port)\n");
	printf("    (gdb) continue\n\n");
	printf("  (Or press Start GDB on DolphinWorks' Debug page.)\n");
	VIDEO_WaitVSync();

	DEBUG_Init(GDBSTUB_DEVICE_USB, chn);
	_break();                                  // waits here until GDB connects, and stops in it

	printf("\x1b[2J\x1b[2;0H");
	printf("  DolphinWorks GDB test: connected to GDB\n\n");
	printf("  A: crash on purpose (GDB stops on the bad line)\n");
	printf("  B: break into GDB\n\n");
	while (1)
	{
		VIDEO_WaitVSync();
		PAD_ScanPads();
		u32 down = PAD_ButtonsDown(0);
		count_frame();
		printf("\x1b[8;0H  Frames: %lu   hp: %d      \n", (unsigned long)frames, hp);
		if (down & PAD_BUTTON_A)
			crash_here();
		if (down & PAD_BUTTON_B)
			_break();
	}
	return 0;
}
