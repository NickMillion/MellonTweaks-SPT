/* eslint-disable @typescript-eslint/indent */
/* eslint-disable @typescript-eslint/quotes */

import { DependencyContainer } from "tsyringe";

import { IPreAkiLoadMod } from "@spt-aki/models/external/IPreAkiLoadMod";
import { IPostAkiLoadMod } from "@spt-aki/models/external/IPostAkiLoadMod";
import { IPostDBLoadMod } from "@spt-aki/models/external/IPostDBLoadMod";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { DatabaseServer } from "@spt-aki/servers/DatabaseServer";
import { ConfigServer } from "@spt-aki/servers/ConfigServer";
import { StaticRouterModService } from "@spt-aki/services/mod/staticRouter/StaticRouterModService";
import { ProfileHelper } from "@spt-aki/helpers/ProfileHelper";

import config from "../config.json";
import configPrivate from "../configPrivate.json";

const debuffCameraEffects = ["QuantumTunnelling", "Contusion"];
const discordInfo = {
  token: "",
  channel: "",
};
const urlsToHandle = ["/client/items"];

class Mod implements IPreAkiLoadMod, IPostAkiLoadMod, IPostDBLoadMod {
  public preAkiLoad(container: DependencyContainer): void {
    const logger = container.resolve<ILogger>("WinstonLogger");
    // Discord bot stuff
    discordInfo.token = configPrivate.DISCORD_TOKEN || "";
    discordInfo.channel = configPrivate.CHANNEL_ID || "";
    if (discordInfo.token !== "" && discordInfo.channel !== "") {
      this.ezLog(logger, "Discord bot enabled!");
    } else {
      this.ezLog(
        logger,
        "No Discord bot ID or channel ID, Discord bot is disabled!"
      );
      return;
    }

    const router = container.resolve<StaticRouterModService>(
      "StaticRouterModService"
    );
    const profiles = container.resolve<ProfileHelper>("ProfileHelper");

    router.registerStaticRouter(
      "MellonTweaks",
      [
        {
          url: "/client/game/start",
          action: (url: any, info: any, sessionID: any, output: any) => {
            try {
              const profile = profiles.getFullProfile(sessionID);
              this.postToDiscord(
                `${profile.characters.pmc.Info.Nickname} has logged in`,
                logger
              );
            } catch (error) {
              logger.error(error.message);
            }
            return output;
          },
        },
        {
          url: "/client/match/offline/end",
          action: (url: any, info: any, sessionID: any, output: any) => {
            try {
              const profile = profiles.getFullProfile(sessionID);
              this.postToDiscord(
                `${profile.characters.pmc.Info.Nickname}'s last raid has ended`,
                logger
              );
            } catch (error) {
              logger.error(error.message);
            }
            return output;
          },
        },
        {
          url: "/coop/server/create",
          action: (url: any, info: any, sessionID: any, output: any) => {
            try {
              const profile = profiles.getFullProfile(sessionID);
              this.postToDiscord(
                `${profile.characters.pmc.Info.Nickname} has started a coop raid`,
                logger
              );
            } catch (error) {
              logger.error(error.message);
            }
            return output;
          },
        },
        {
          url: "/client/game/logout",
          action: (url: any, info: any, sessionID: any, output: any) => {
            try {
              const profile = profiles.getFullProfile(sessionID);
              this.postToDiscord(
                `${profile.characters.pmc.Info.Nickname} has logged out`,
                logger
              );
            } catch (error) {
              logger.error(error.message);
            }
            return output;
          },
        },
      ],
      "aki"
    );
  }

  public postDBLoad(container: DependencyContainer): void {
    // Database will be loaded, this is the fresh state of the DB so NOTHING from the AKI
    // logic has modified anything yet. This is the DB loaded straight from the JSON files
    const databaseServer = container
      .resolve<DatabaseServer>("DatabaseServer")
      .getTables();
    const configServer = container.resolve<ConfigServer>("ConfigServer");
    const logger = container.resolve<ILogger>("WinstonLogger");

    this.ezLog(logger, "Loading Mellon Tweaks!");
    if (config.debugPrintChanges) {
      this.ezLog(logger, `Config: ${JSON.stringify(config)}`);
    }

    // We need these to edit the db or backend configs
    const items = databaseServer.templates.items;
    const globals = databaseServer.globals.config;
    const quests = databaseServer.templates.quests;
    const traders = databaseServer.traders;
    const questConfig = configServer.getConfig("aki-quest");
    const repair = configServer.getConfig("aki-repair");
    const trader = configServer.getConfig("aki-trader");
    const Insurance = configServer.getConfig("aki-insurance");

    // If any of the 3 are undefined, error out
    if (!items || !globals || !quests) {
      throw new Error("One of the required tables is undefined!");
    }

    // Buff stuff
    // globals.Health.Effects.Stimulator.Buffs
    if (config.buffTimersMult && config.buffTimersMult !== 1) {
      let changedBuffs = 0;
      // Iterate through all buffs
      for (const buffName in globals.Health.Effects.Stimulator.Buffs) {
        const buff = globals.Health.Effects.Stimulator.Buffs[buffName];
        let changed = false;
        for (const buffIdx in buff) {
          const buffEffect = buff[buffIdx];
          // Check the Value and Duration of this buff, if the Value is positive, multiply by the config value
          if (buffEffect.Value > 0) {
            buffEffect.Duration = Math.max(
              1,
              Math.floor(buffEffect.Duration * config.buffTimersMult)
            );
            buffEffect.Value *= config.debuffPotencyMult;
            changed = true;
          } else {
            buffEffect.Duration = Math.max(
              1,
              Math.floor(buffEffect.Duration * config.debuffTimersMult)
            );
            buffEffect.Value *= config.debuffPotencyMult;
            changed = true;
          }
          if (
            config.removeDebuffCameraEffects &&
            debuffCameraEffects.includes(buffName)
          ) {
            buffEffect.Delay = 0;
            buffEffect.Chance = 0.01;
            buffEffect.Duration = 1;
          }
        }
        if (changed) {
          if (config.debugPrintChanges) {
            this.ezLog(logger, `Nick - Updated buff ${buffName}!`);
          }
          changedBuffs++;
        }
      }
      // Log the changes
      this.ezLog(logger, `Nick - Changed ${changedBuffs} buffs`);
    }

    // Inertia stuff
    // globals.Inertia
    if (config.softRemovedInertia) {
      globals.Inertia.BaseJumpPenalty = 0.03; // 0.3
      globals.Inertia.BaseJumpPenaltyDuration = 0.4;
      globals.Inertia.MinDirectionBlendTime = 0.01;
      globals.Inertia.CrouchSpeedAccelerationRange = {
        x: 4.75, // 0.475
        y: 7.5, // 0.75
        z: 0,
      };
      globals.Inertia.ExitMovementStateSpeedThreshold = {
        x: 0.001, // 0.01
        y: 0.001, // 0.01
        z: 0,
      };
      globals.Inertia.InertiaLimitsStep = 0.1;
      globals.Inertia.MaxTimeWithoutInput = {
        x: 0.01, // 0.1
        y: 0.03, // 0.3
        z: 0,
      };
      globals.Inertia.PenaltyPower = 1.01; // 1.23
      globals.Inertia.SideTime = {
        x: 1, // 2
        y: 0.5, // 1
        z: 0,
      };
      globals.Inertia.PreSprintAccelerationLimits = {
        x: 8,
        y: 4,
        z: 0,
      };
      globals.Inertia.SprintAccelerationLimits = {
        x: 15,
        y: 0,
        z: 0,
      };
      globals.Inertia.SprintBrakeInertia = {
        x: 0,
        y: 55,
        z: 0,
      };
      globals.Inertia.SprintTransitionMotionPreservation = {
        x: 0.006,
        y: 0.008,
        z: 0,
      };
      globals.Inertia.WalkInertia = {
        x: 0.002,
        y: 0.025,
        z: 0,
      };
      this.ezLog(logger, "Nick - Removed inertia, probably!");
    }

    // Weight limit / stamina stuff
    // globals.Stamina
    if (config.staminaMult && config.staminaMult !== 1) {
      // Capacity and OxygenCapacity and HandsCapacity
      globals.Stamina.Capacity = Math.floor(
        globals.Stamina.Capacity * config.staminaMult
      );
      globals.Stamina.OxygenCapacity = Math.floor(
        globals.Stamina.OxygenCapacity * config.staminaMult
      );
      globals.Stamina.HandsCapacity = Math.floor(
        globals.Stamina.HandsCapacity * config.staminaMult
      );
      this.ezLog(
        logger,
        `Nick - Updated stamina! New values: Capacity ${globals.Stamina.Capacity}, Oxygen ${globals.Stamina.OxygenCapacity}, Hands ${globals.Stamina.HandsCapacity}`
      );
    }
    if (config.weightLimitMult && config.weightLimitMult !== 1) {
      // Always an object of x,y,z; should always be floored and min of 0
      // BaseOverweightLimits, SprintOverweightLimits, WalkOverweightLimits, WalkSpeedOverweightLimits
      globals.Stamina.BaseOverweightLimits = {
        x: Math.max(
          0,
          Math.floor(
            globals.Stamina.BaseOverweightLimits.x * config.weightLimitMult
          )
        ),
        y: Math.max(
          0,
          Math.floor(
            globals.Stamina.BaseOverweightLimits.y * config.weightLimitMult
          )
        ),
        z: Math.max(
          0,
          Math.floor(
            globals.Stamina.BaseOverweightLimits.z * config.weightLimitMult
          )
        ),
      };
      globals.Stamina.SprintOverweightLimits = {
        x: Math.max(
          0,
          Math.floor(
            globals.Stamina.SprintOverweightLimits.x * config.weightLimitMult
          )
        ),
        y: Math.max(
          0,
          Math.floor(
            globals.Stamina.SprintOverweightLimits.y * config.weightLimitMult
          )
        ),
        z: Math.max(
          0,
          Math.floor(
            globals.Stamina.SprintOverweightLimits.z * config.weightLimitMult
          )
        ),
      };
      globals.Stamina.WalkOverweightLimits = {
        x: Math.max(
          0,
          Math.floor(
            globals.Stamina.WalkOverweightLimits.x * config.weightLimitMult
          )
        ),
        y: Math.max(
          0,
          Math.floor(
            globals.Stamina.WalkOverweightLimits.y * config.weightLimitMult
          )
        ),
        z: Math.max(
          0,
          Math.floor(
            globals.Stamina.WalkOverweightLimits.z * config.weightLimitMult
          )
        ),
      };
      globals.Stamina.WalkSpeedOverweightLimits = {
        x: Math.max(
          0,
          Math.floor(
            globals.Stamina.WalkSpeedOverweightLimits.x * config.weightLimitMult
          )
        ),
        y: Math.max(
          0,
          Math.floor(
            globals.Stamina.WalkSpeedOverweightLimits.y * config.weightLimitMult
          )
        ),
        z: Math.max(
          0,
          Math.floor(
            globals.Stamina.WalkSpeedOverweightLimits.z * config.weightLimitMult
          )
        ),
      };
      this.ezLog(
        logger,
        `Nick - Updated weight limits! New values: Base ${JSON.stringify(
          globals.Stamina.BaseOverweightLimits
        )}, Sprint ${JSON.stringify(
          globals.Stamina.SprintOverweightLimits
        )}, Walk ${JSON.stringify(
          globals.Stamina.WalkOverweightLimits
        )}, WalkSpeed ${JSON.stringify(
          globals.Stamina.WalkSpeedOverweightLimits
        )}`
      );
    }

    // Item stuff
    let updatedItems = 0;
    for (const itemIdx in items) {
      const item = items[itemIdx];
      // Skip if item._props is undefined; I have no idea if this is even possible
      if (!item._props) {
        continue;
      }
      let updated = false;

      // Armor stuff
      // Iterate through the slots
      if (item._props.Slots) {
        // Each slot here has a _props with a filters array; we want to check the armorColliders array in here
        const slots: any[] = Object.values(item._props.Slots);
        for (const slotIdx in slots) {
          const slot: any = slots[slotIdx];
          if (slot._props.filters) {
            const filters = Object.values(slot._props.filters);
            for (const filterIdx in filters) {
              const filter: any = filters[filterIdx];
              if (filter.armorColliders && filter.armorColliders.length > 0) {
                // add LeftSideChestUp if LeftSideChestDown, add RightSideChestUp if RightSideChestDown
                if (config.sideArmorsArmpits) {
                  if (
                    filter.armorColliders.includes("LeftSideChestDown") &&
                    !filter.armorColliders.includes("LeftSideChestUp")
                  ) {
                    filter.armorColliders.push("LeftSideChestUp");
                    updated = true;
                    if (config.debugPrintChanges) {
                      this.ezLog(
                        logger,
                        `Nick - Added LeftSideChestUp to ${item._id} / ${item._name} / ${item._props.name}!`
                      );
                    }
                  }
                  if (
                    filter.armorColliders.includes("RightSideChestDown") &&
                    !filter.armorColliders.includes("RightSideChestUp")
                  ) {
                    filter.armorColliders.push("RightSideChestUp");
                    updated = true;
                    if (config.debugPrintChanges) {
                      this.ezLog(
                        logger,
                        `Nick - Added RightSideChestUp to ${item._id} / ${item._name} / ${item._props.name}!`
                      );
                    }
                  }
                }
                // Add NeckFront if RibcageUp, Add NeckBack if SpineTop
                if (config.chestArmorsNeck) {
                  if (
                    filter.armorColliders.includes("RibcageUp") &&
                    !filter.armorColliders.includes("NeckFront")
                  ) {
                    filter.armorColliders.push("NeckFront");
                    updated = true;
                    if (config.debugPrintChanges) {
                      this.ezLog(
                        logger,
                        `Nick - Added NeckFront Armor to ${item._id} / ${item._name} / ${item._props.name}!`
                      );
                    }
                  }
                  if (
                    filter.armorColliders.includes("SpineTop") &&
                    !filter.armorColliders.includes("NeckBack")
                  ) {
                    filter.armorColliders.push("NeckBack");
                    updated = true;
                    if (config.debugPrintChanges) {
                      this.ezLog(
                        logger,
                        `Nick - Added NeckBack Armor to ${item._id} / ${item._name} / ${item._props.name}!`
                      );
                    }
                  }
                }
                // Add LeftSideChestUp if LeftUpperArm, Add RightSideChestUp if RightUpperArm
                if (config.armsArmorsArmpits) {
                  if (
                    filter.armorColliders.includes("LeftUpperArm") &&
                    !filter.armorColliders.includes("LeftSideChestUp")
                  ) {
                    filter.armorColliders.push("LeftSideChestUp");
                    updated = true;
                    if (config.debugPrintChanges) {
                      this.ezLog(
                        logger,
                        `Nick - Added LeftSideChestUp to ${item._id} / ${item._name} / ${item._props.name}!`
                      );
                    }
                  }
                  if (
                    filter.armorColliders.includes("RightUpperArm") &&
                    !filter.armorColliders.includes("RightSideChestUp")
                  ) {
                    filter.armorColliders.push("RightSideChestUp");
                    updated = true;
                    if (config.debugPrintChanges) {
                      this.ezLog(
                        logger,
                        `Nick - Added RightSideChestUp to ${item._id} / ${item._name} / ${item._props.name}!`
                      );
                    }
                  }
                }
                // If Jaw add NeckFront, if ParietalHead add NeckBack
                if (config.jawsArmorsNeck) {
                  if (
                    filter.armorColliders.includes("Jaw") &&
                    !filter.armorColliders.includes("NeckFront")
                  ) {
                    filter.armorColliders.push("NeckFront");
                    updated = true;
                    if (config.debugPrintChanges) {
                      this.ezLog(
                        logger,
                        `Nick - Added NeckFront Armor to ${item._id} / ${item._name} / ${item._props.name}!`
                      );
                    }
                  }
                  if (
                    filter.armorColliders.includes("ParietalHead") &&
                    !filter.armorColliders.includes("NeckBack")
                  ) {
                    filter.armorColliders.push("NeckBack");
                    updated = true;
                    if (config.debugPrintChanges) {
                      this.ezLog(
                        logger,
                        `Nick - Added NeckBack Armor to ${item._id} / ${item._name} / ${item._props.name}!`
                      );
                    }
                  }
                }
              }
            }
          } else {
            continue;
          }
        }
      }

      // Helmet stuff
      let helmetUpdated = false;
      if (config.earProWithAllHelmets && item._props.BlocksEarpiece) {
        item._props.BlocksEarpiece = false;
        helmetUpdated = true;
      }
      if (config.eyeWearWithAllHelmets && item._props.BlocksEyewear) {
        item._props.BlocksEyewear = false;
        helmetUpdated = true;
      }
      if (config.headWearWithAllHelmets && item._props.BlocksHeadwear) {
        item._props.BlocksHeadwear = false;
        helmetUpdated = true;
      }
      if (config.faceCoverWithAllHelmets && item._props.BlocksFaceCover) {
        item._props.BlocksFaceCover = false;
        helmetUpdated = true;
      }
      if (config.debugPrintChanges && helmetUpdated) {
        this.ezLog(
          logger,
          `Nick - Updated helmet ${item._id} / ${item._name} / ${item._props.name}!`
        );
      }

      if (config.allowRigsAndArmorStacking && item._props.BlocksArmorVest) {
        item._props.BlocksArmorVest = false;
        updated = true;
        if (config.debugPrintChanges) {
          this.ezLog(
            logger,
            `Nick - Added armor stacking for ${item._id} / ${item._name} / ${item._props.name}!`
          );
        }
      }

      if (config.removeSensitivityChanges) {
        if (item._props.mousePenalty && item._props.mousePenalty !== 0) {
          item._props.mousePenalty = 0;
          updated = true;
          if (config.debugPrintChanges) {
            this.ezLog(
              logger,
              `Nick - Removed sensitivity changes for ${item._id} / ${item._name} / ${item._props.Name}!`
            );
          }
        }
      }

      if (updated || helmetUpdated) {
        updatedItems++;
      }
    }
    this.ezLog(logger, `Nick - Updated ${updatedItems} items`);

    // Quest stuff
    let updatedQuests = 0;
    for (const questIdx in quests) {
      const quest = quests[questIdx];
      const rewards = quest.rewards;
      if (rewards?.Success) {
        if (
          config.questExperienceRewardMult &&
          config.questExperienceRewardMult !== 1
        ) {
          // Find the reward with the type "Experience"
          const expReward = rewards.Success.find(
            (reward) => reward.type === "Experience"
          );
          if (expReward) {
            expReward.value = Math.floor(
              expReward.value * config.questExperienceRewardMult
            );
            if (config.debugPrintChanges) {
              this.ezLog(
                logger,
                `Nick - Updated quest ${quest._id} / ${quest.QuestName}! New exp: ${expReward.value}`
              );
            }
            updatedQuests++;
          }
        }
        if (config.removeRepLossQuestReward) {
          // For any with the type "TraderStanding" and a negative value, set to 0
          rewards.Success.forEach((reward) => {
            if (reward.type === "TraderStanding" && reward.value < 0) {
              reward.value = 0;
              if (config.debugPrintChanges) {
                this.ezLog(
                  logger,
                  `Nick - Updated quest ${quest._id} / ${quest.QuestName}! Removed rep loss`
                );
              }
              updatedQuests++;
            }
          });
        }
      }
    }
    this.ezLog(logger, `Nick - Updated ${updatedQuests} quests`);

    // Repeatable quests
    if (
      config.dailyAndWeeklyQuestCount &&
      config.dailyAndWeeklyQuestCount > 0
    ) {
      // Daily
      questConfig.repeatableQuests[0].numQuests =
        config.dailyAndWeeklyQuestCount;
      // Weekly
      questConfig.repeatableQuests[1].numQuests =
        config.dailyAndWeeklyQuestCount;
      // Scav
      questConfig.repeatableQuests[2].numQuests =
        config.dailyAndWeeklyQuestCount;
      this.ezLog(
        logger,
        `Nick - Updated repeatable quests! New daily and weekly quest count: ${config.dailyAndWeeklyQuestCount}`
      );
    }

    // Fleamarket
    if (config.removeFleaMarketPlayerSelling) {
      const offer = {
        from: -999,
        to: 999,
        count: 0,
      };
      globals.RagFair.maxActiveOfferCount = [offer];
      this.ezLog(logger, `Nick - Removed player selling from flea market!`);
    }
    if (
      config.vendorTradeSellPriceBonusPerLoyaltyLevel &&
      config.vendorTradeSellPriceBonusPerLoyaltyLevel !== 1
    ) {
      for (const traderIdx in traders) {
        const traderData = traders[traderIdx];
        let loyaltyLevel = 0;
        if (traderIdx !== "ragfair") {
          for (const loyalty in traderData.base.loyaltyLevels) {
            if (loyaltyLevel === 0) {
              // Skip the first level
              loyaltyLevel++;
              continue;
            }
            const oldCoeff =
              traderData?.base?.loyaltyLevels[loyalty]?.buy_price_coef;
            if (!oldCoeff || oldCoeff === 0) {
              continue;
            }
            // Caps at 80%, it's inverted
            traderData.base.loyaltyLevels[loyalty].buy_price_coef = Math.max(
              20,
              traderData.base.loyaltyLevels[loyalty].buy_price_coef *
                (1 -
                  loyaltyLevel *
                    config.vendorTradeSellPriceBonusPerLoyaltyLevel)
            );
            // Round it
            traderData.base.loyaltyLevels[loyalty].buy_price_coef = Math.round(
              traderData.base.loyaltyLevels[loyalty].buy_price_coef
            );
            if (config.debugPrintChanges) {
              this.ezLog(
                logger,
                `Nick - Updated trader ${traderData.base.nickname}! ${oldCoeff} -> ${traderData.base.loyaltyLevels[loyalty].buy_price_coef} at loyalty level ${loyaltyLevel}`
              );
            }
            loyaltyLevel++;
          }
        }
      }
      this.ezLog(
        logger,
        `Nick - Updated vendor trade sell price bonus per loyalty level!`
      );
    }
    if (config.fleaMarketMinLevel) {
      globals.RagFair.minUserLevel = config.fleaMarketMinLevel;
      this.ezLog(
        logger,
        `Nick - Set minimum flea market level to ${config.fleaMarketMinLevel}`
      );
    }

    if (config.vendorPurchasesFIR) {
      trader.purchasesAreFoundInRaid = config.vendorPurchasesFIR;
      this.ezLog(
        logger,
        `Nick - Set vendor purchases FIR to ${config.vendorPurchasesFIR}`
      );
    }

    if (config.improvedInsurance) {
      // 10% cost, 75% return chance for Prapor, 50% cost, 100% return chance for Therapist
      Insurance.insuranceMultiplier["54cb50c76803fa8b248b4571"] = 0.1;
      Insurance.returnChancePercent["54cb50c76803fa8b248b4571"] = 75;
      Insurance.insuranceMultiplier["54cb57776803fa99248b456e"] = 0.5;
      Insurance.returnChancePercent["54cb57776803fa99248b456e"] = 100;

      // 0-1 hour return time (unsure if I can do 0-0 hours?)
      traders["54cb50c76803fa8b248b4571"].base.insurance.min_return_hour = 0;
      traders["54cb50c76803fa8b248b4571"].base.insurance.max_return_hour = 1;
      traders["54cb57776803fa99248b456e"].base.insurance.min_return_hour = 0;
      traders["54cb57776803fa99248b456e"].base.insurance.max_return_hour = 1;

      globals.Insurance.MaxStorageTimeInHour = 168;
      this.ezLog(logger, "Nick - Improved insurance!");
    }

    // Improved repair
    if (config.improvedRepair) {
      repair.maxIntellectGainPerRepair.kit = 10;
      repair.maxIntellectGainPerRepair.trader = 10;
      repair.armorKitSkillPointGainPerRepairPointMultiplier = 0.1;
      this.ezLog(logger, "Nick - Improved repair!");
    }

    // Just a flat 3x multiplier for all experience, no weird fresh points or fatigue
    if (config.standardizeExperience) {
      globals.SkillsSettings.SkillProgressRate = 2;
      globals.SkillsSettings.WeaponSkillProgressRate = 2;
      globals.SkillMinEffectiveness = 0.1;
      globals.SkillFatiguePerPoint = 1;
      globals.SkillFreshEffectiveness = 1;
      globals.SkillFreshPoints = 1;
      globals.SkillPointsBeforeFatigue = 9999;
      globals.SkillFatigueReset = 9999;
      this.ezLog(logger, "Nick - Standardized experience!");
    }

    this.postToDiscord("The Mellon Farm is online! 🍈", logger);
  }

  private ezLog(logger: ILogger, message: string): void {
    logger.log(`MellonTweaks: ${message}`, "white");
  }

  private postToDiscord(message: string, logger?: ILogger): void {
    // If the botID is empty, don't do anything
    if (!discordInfo.token || discordInfo.token == "") {
      return;
    }
    const axios = require("axios");
    axios
      .post(
        `https://discord.com/api/v9/channels/${discordInfo.channel}/messages`,
        {
          content: message,
        },
        {
          headers: {
            Authorization: `Bot ${discordInfo.token}`,
          },
        }
      )
      .catch((err: any) => {
        console.log(err);
      });
    this.ezLog(logger, `Posted to Discord: ${message}`);
  }
}

module.exports = { mod: new Mod() };
