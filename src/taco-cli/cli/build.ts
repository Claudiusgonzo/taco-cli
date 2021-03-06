﻿// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

/// <reference path="../../typings/tacoUtils.d.ts" />
/// <reference path="../../typings/node.d.ts" />
/// <reference path="../../typings/nopt.d.ts" />
/// <reference path="../../typings/cordovaExtensions.d.ts" />
/// <reference path="../../typings/rimraf.d.ts" />
"use strict";

import assert = require ("assert");
import child_process = require ("child_process");
import fs = require ("fs");
import nopt = require ("nopt");
import path = require ("path");
import Q = require ("q");
import rimraf = require ("rimraf");

import buildTelemetryHelper = require("./utils/buildTelemetryHelper");
import CleanHelperModule = require("./utils/cleanHelper");
import errorHelper = require ("./tacoErrorHelper");
import PlatformHelper = require ("./utils/platformHelper");
import RemoteBuildClientHelper = require ("./remoteBuild/remoteBuildClientHelper");
import RemoteBuildSettings = require ("./remoteBuild/buildSettings");
import resources = require ("../resources/resourceManager");
import Settings = require ("./utils/settings");
import TacoErrorCodes = require ("./tacoErrorCodes");
import tacoUtility = require ("taco-utils");

import CleanHelper = CleanHelperModule.CleanHelper;
import commands = tacoUtility.Commands;
import CordovaWrapper = tacoUtility.CordovaWrapper;
import logger = tacoUtility.Logger;
import ProjectHelper = tacoUtility.ProjectHelper;
import UtilHelper = tacoUtility.UtilHelper;
import ICommandTelemetryProperties = tacoUtility.ICommandTelemetryProperties;

/**
 * Build
 *
 * handles "taco build"
 */
class Build extends commands.TacoCommandBase {
    /*
     * Exposed for testing purposes: when we talk to a mocked server we don't want 5s delays between pings
     */
    public static remoteBuild: typeof RemoteBuildClientHelper = RemoteBuildClientHelper;

    private static KNOWN_OPTIONS: Nopt.CommandData = {
        local: Boolean,
        remote: Boolean,
        clean: Boolean,
        debug: Boolean,
        release: Boolean,
        device: Boolean,
        emulator: Boolean,
        target: String
    };
    private static SHORT_HANDS: Nopt.ShortFlags = {};

    public name: string = "build";
    public info: commands.ICommandInfo;

    private static generateTelemetryProperties(telemetryProperties: tacoUtility.ICommandTelemetryProperties,
        commandData: commands.ICommandData): Q.Promise<tacoUtility.ICommandTelemetryProperties> {
        return buildTelemetryHelper.addCommandLineBasedPropertiesForBuildAndRun(telemetryProperties, Build.KNOWN_OPTIONS, commandData);
    }

    private static buildRemotePlatform(platform: string, commandData: commands.ICommandData, telemetryProperties: ICommandTelemetryProperties): Q.Promise<any> {
        var configuration: string = commandData.options["release"] ? "release" : "debug";
        var buildTarget: string  = commandData.options["target"] || (commandData.options["device"] ? "device" : commandData.options["emulator"] ? "emulator" : "");
        return Q.all<any>([Settings.loadSettings(), CordovaWrapper.getCordovaVersion()]).spread<any>((settings: Settings.ISettings, cordovaVersion: string) => {
            var language: string = settings.language || "en";
            var remoteConfig: Settings.IRemoteConnectionInfo = settings.remotePlatforms && settings.remotePlatforms[platform];
            if (!remoteConfig) {
                throw errorHelper.get(TacoErrorCodes.CommandRemotePlatformNotKnown, platform);
            }

            var buildSettings: RemoteBuildSettings = new RemoteBuildSettings({
                projectSourceDir: path.resolve("."),
                buildServerInfo: remoteConfig,
                buildCommand: "build",
                platform: platform,
                configuration: configuration,
                buildTarget: buildTarget,
                language: language,
                cordovaVersion: cordovaVersion
            });
            return Build.remoteBuild.build(buildSettings, telemetryProperties);
        });
    }

    protected runCommand(): Q.Promise<ICommandTelemetryProperties> {
        if (ProjectHelper.isTypeScriptProject()) {
            logger.log(resources.getString("CommandCreateInstallGulp"));
        }

        var commandData: commands.ICommandData = this.data;

        var telemetryProperties: tacoUtility.ICommandTelemetryProperties = {};
        return Q.all<any>([PlatformHelper.determinePlatform(commandData), Settings.loadSettingsOrReturnEmpty()])
           .spread((platforms: PlatformHelper.IPlatformWithLocation[], settings: Settings.ISettings) => {
            buildTelemetryHelper.storePlatforms(telemetryProperties, "actuallyBuilt", platforms, settings);
            var cleanPromise: Q.Promise<any> = Q({});
            if (commandData.options["clean"]) {
                cleanPromise = CleanHelper.cleanPlatforms(platforms, commandData);
            }

            return cleanPromise.then((): Q.Promise<any> => {
                return PlatformHelper.operateOnPlatforms(platforms,
                    (localPlatforms: string[]): Q.Promise<any> => CordovaWrapper.build(commandData, localPlatforms),
                    (remotePlatform: string): Q.Promise<any> => Build.buildRemotePlatform(remotePlatform, commandData, telemetryProperties)
                    );
            });
        }).then(() => Build.generateTelemetryProperties(telemetryProperties, commandData));
    }

    public parseArgs(args: string[]): commands.ICommandData {
        var parsedOptions: commands.ICommandData = tacoUtility.ArgsHelper.parseArguments(Build.KNOWN_OPTIONS, Build.SHORT_HANDS, args, 0);

        // Raise errors for invalid command line parameters
        if (parsedOptions.options["remote"] && parsedOptions.options["local"]) {
            throw errorHelper.get(TacoErrorCodes.ErrorIncompatibleOptions, "--remote", "--local");
        }

        if (parsedOptions.options["device"] && parsedOptions.options["emulator"]) {
            throw errorHelper.get(TacoErrorCodes.ErrorIncompatibleOptions, "--device", "--emulator");
        }

        if (parsedOptions.options["debug"] && parsedOptions.options["release"]) {
            throw errorHelper.get(TacoErrorCodes.ErrorIncompatibleOptions, "--debug", "--release");
        }

        return parsedOptions;
    }

}

export = Build;
