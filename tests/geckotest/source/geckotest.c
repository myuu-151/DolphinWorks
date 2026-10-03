// geckotest: checks the USB Gecko link both ways. Finds the Gecko (memory card slot A, else B), sends
// "hello from the GameCube #N" every second, and echoes back each line the PC sends. The TV shows the
// same, so it's clear what happened even if nothing reaches the PC. START returns to the loader (Swiss).
#include <gccore.h>
#include <ogc/usbgecko.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void *xfb;
static GXRModeObj *mode;

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

// Never waits: the Gecko takes what it has room for and the rest is dropped. (usb_sendbuffer_safe waits for
// every byte, and with nothing reading the COM port on the PC the Gecko's buffer fills and it waits forever:
// the program froze, START included.) A few tries cover a PC that's reading but a little behind.
static u32 dropped;

// returns whether all of it got through (a PC is reading)
static bool send(s32 chn, const char *text)
{
	int len = strlen(text), done = 0;
	for (int tries = 0; done < len && tries < 50; tries++)
		done += usb_sendbuffer(chn, text + done, len - done);
	if (done < len)
		dropped += len - done;
	return done == len;
}

int main(void)
{
	video_init();
	printf("\x1b[2;0H");
	printf("  DolphinWorks USB Gecko test\n\n");

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
	printf("  USB Gecko found in slot %c.\n", chn == EXI_CHANNEL_0 ? 'A' : 'B');
	printf("  On the PC, open DolphinWorks > Debug to see these lines\n");
	printf("  and send some back. Press START to go back.\n\n");
	usb_flush(chn);
	char line[160];                              // (room for "echo: " and a whole received line)
	snprintf(line, sizeof(line), "\r\nhello from the GameCube: USB Gecko in slot %c\r\n", chn == EXI_CHANNEL_0 ? 'A' : 'B');
	send(chn, line);

	char got[128];
	int got_len = 0;
	u32 frame = 0, count = 0;
	while (1)
	{
		VIDEO_WaitVSync();
		PAD_ScanPads();
		if (PAD_ButtonsDown(0) & PAD_BUTTON_START)
		{
			send(chn, "bye from the GameCube\r\n");
			exit(0);
		}

		// what the PC sent: gathered into lines, each echoed back and shown
		char buf[64];
		int n = usb_recvbuffer(chn, buf, sizeof(buf));
		for (int i = 0; i < n; i++)
		{
			char c = buf[i];
			if (c == '\r')
				continue;
			if (c == '\n' || got_len == (int)sizeof(got) - 1)
			{
				got[got_len] = 0;
				snprintf(line, sizeof(line), "echo: %s\r\n", got);
				send(chn, line);
				printf("\x1b[12;0H  From the PC: %-40.40s\n", got);
				got_len = 0;
			}
			else
				got[got_len++] = c;
		}

		if (++frame % 60 == 0)                 // about once a second
		{
			count++;
			snprintf(line, sizeof(line), "hello from the GameCube #%lu\r\n", (unsigned long)count);
			bool heard = send(chn, line);
			printf("\x1b[10;0H  Sent: hello from the GameCube #%lu   \n", (unsigned long)count);
			if (heard)
				printf("\x1b[11;0H  PC: listening                                    \n");
			else
				printf("\x1b[11;0H  PC: not listening (%lu bytes dropped)            \n", (unsigned long)dropped);
		}
	}
	return 0;
}
