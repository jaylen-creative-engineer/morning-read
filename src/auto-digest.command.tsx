import { LaunchProps, LaunchType, Toast, environment, showToast, updateCommandMetadata } from "@raycast/api";
import { sendNotification } from "./utils/notify";
import { normalizePreference } from "./utils/preference";
import * as chrono from "chrono-node";
import { bizGenDigest, categorizeSources, isValidNotificationTime } from "./utils/biz";
import { isAfter, subMinutes, differenceInMinutes, addMinutes, addDays } from "date-fns";
import { NO_API_KEY, NO_FEEDS, matchError } from "./utils/error";
import {
  getLastNotifyTime,
  getSources,
  checkTodaysDigestExist,
  saveLastNotifyTime,
  getTodaysDigest,
  saveNextScheduledTime,
  getNextScheduledTime,
} from "./store";
import dayjs from "dayjs";
import NotionService from "./utils/notion";
import { Digest } from "./types";

async function handleGenDigest(onSuccess: (digest: Digest) => void = () => {}, enableError: boolean = false) {
  try {
    console.log("start to gen digest...");
    const digest = await bizGenDigest();
    await onSuccess(digest);
  } catch (err: any) {
    if (!enableError) return;
    // 已没有抛出此错误，不会走到此逻辑
    if (matchError(err, NO_API_KEY)) {
      await sendNotification({
        title: "Daily Digest Success",
        message: "View 'Daily Read' command to see today's digest.",
      });
      return;
    }

    if (matchError(err, NO_FEEDS)) {
      await sendNotification({
        title: "Daily Digest Failed",
        message: "No RSS link found in today's sources, please add some and try again.",
      });
      return;
    }
  }
}

async function handleSuccess(digest: Digest) {
  await sendNotification({
    title: "Daily Digest Success",
    message: "View 'Daily Read' command to see today's digest.",
  });

  await updateCommandMetadata({
    subtitle: `Last auto digest at: ${dayjs().format("YYYY-MM-DD HH:mm")}`,
  });

  const notionService = new NotionService();
  try {
    const result = await notionService.updateMorningBriefDb(digest);
    console.log("Notion update successful:", result);
    await sendNotification({
      title: "Notion Update Success",
      message: "Today's digest has been added to Notion.",
    });
  } catch (error) {
    console.error("Failed to update Notion:", error);
    await sendNotification({
      title: "Notion Update Failed",
      message: "Failed to add today's digest to Notion.",
    });
  }
}

export default async function Command(props: LaunchProps<{ launchContext: { regenerate: boolean } }>) {
  const regenerate = props?.launchContext?.regenerate ?? false;
  const sources = await getSources();
  const { todayItems } = categorizeSources(sources);
  const { notificationTime } = normalizePreference();
  const defaultNotificationTime = "8am";
  const finalNotificationTime = notificationTime || defaultNotificationTime;

  if (environment.launchType === LaunchType.UserInitiated) {
    showToast(
      Toast.Style.Success,
      `Activated! Your daily digest will automatically generate at ${finalNotificationTime}`,
    );
  }

  // If there are no items for today, no need to notify
  if (todayItems.length === 0) return;

  const now = new Date();
  const lastNotifyTime = await getLastNotifyTime();
  const minimumInterval = 60; // minimum interval in minutes between checks

  const formattedTime = !isValidNotificationTime(finalNotificationTime)
    ? chrono.parseDate("8am", now)
    : chrono.parseDate(finalNotificationTime, now);

  const preTime = subMinutes(formattedTime, 10);

  // Check if it's time to perform an action
  const nextScheduledTime = await getNextScheduledTime();
  if (nextScheduledTime && now < new Date(nextScheduledTime)) {
    console.log(`Not time for action yet. Next scheduled time: ${new Date(nextScheduledTime)}`);
    return;
  }

  // If last notify time exists and it's been less than the minimum interval, wait
  if (lastNotifyTime && differenceInMinutes(now, new Date(lastNotifyTime)) < minimumInterval) {
    const nextCheck = addMinutes(new Date(lastNotifyTime), minimumInterval);
    await saveNextScheduledTime(nextCheck.getTime());
    console.log(`Too soon for next check. Next scheduled time: ${nextCheck}`);
    return;
  }

  // Perform actions based on the current time
  if (isAfter(now, preTime)) {
    const todaysDigestExist = await checkTodaysDigestExist();

    if (!todaysDigestExist || regenerate) {
      await handleGenDigest(async (digest) => {
        await handleSuccess(digest);
      }, true);
    } else if (await checkTodaysDigestExist("auto")) {
      const todaysDigest = await getTodaysDigest();
      if (todaysDigest) {
        await handleSuccess(todaysDigest);
      } else {
        console.log("Today's digest not found");
      }
    } else {
      console.log(`Today's digest was manually generated`);
      await sendNotification({
        title: "Daily Digest Success",
        message: "You have generated it manually yourself, go to the 'Daily Read' command and check it out.",
      });
    }

    await saveLastNotifyTime(+now);

    // Set the next check to the notification time for tomorrow
    const tomorrowNotificationTime = addDays(formattedTime, 1);
    await saveNextScheduledTime(tomorrowNotificationTime.getTime());
  } else {
    // If it's not yet pre-time, set the next check to the pre-time
    // But ensure it's not earlier than the minimum interval from now
    const nextCheck = new Date(Math.max(preTime.getTime(), addMinutes(now, minimumInterval).getTime()));
    
    // If nextCheck is after formattedTime (8am), set it to formattedTime
    if (isAfter(nextCheck, formattedTime)) {
      await saveNextScheduledTime(formattedTime.getTime());
    } else {
      await saveNextScheduledTime(nextCheck.getTime());
    }
  }

  // Update the command's metadata
  const nextCheck = await getNextScheduledTime();
  if (nextCheck) {
    const minutesUntilNextCheck = differenceInMinutes(new Date(nextCheck), now);
    await updateCommandMetadata({
      subtitle: `Next check in ${minutesUntilNextCheck} minutes`,
    });
  }
}
