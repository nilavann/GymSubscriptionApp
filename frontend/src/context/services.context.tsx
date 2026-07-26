import { createContext, useContext, type ReactNode } from 'react';
import { authService, type AuthService } from '../services/auth.service';
import { memberService, type MemberService } from '../services/member.service';
import { subscriptionService, type SubscriptionService } from '../services/subscription.service';
import { branchService, type BranchService } from '../services/branch.service';
import { planService, type PlanService } from '../services/plan.service';
import { roleService, type RoleService } from '../services/role.service';
import { reportService, type ReportService } from '../services/report.service';
import { userService, type UserService } from '../services/user.service';
import { profileRepository, type ProfileRepository } from '../repositories/profile.repository';
import { memberRepository, type MemberRepository } from '../repositories/member.repository';
import { branchRepository, type BranchRepository } from '../repositories/branch.repository';
import { planRepository, type PlanRepository } from '../repositories/plan.repository';
import { roleRepository, type RoleRepository } from '../repositories/role.repository';
import { memberListRepository, type MemberListRepository } from '../repositories/member-list.repository';
import { subscriptionRepository, type SubscriptionRepository } from '../repositories/subscription.repository';
import { auditLogRepository, type AuditLogRepository } from '../repositories/audit-log.repository';
import { memberNumberingRepository, type MemberNumberingRepository } from '../repositories/member-numbering.repository';
import { memberNumberingService, type MemberNumberingService } from '../services/member-numbering.service';

export interface Services {
  authService: AuthService;
  memberService: MemberService;
  subscriptionService: SubscriptionService;
  branchService: BranchService;
  planService: PlanService;
  roleService: RoleService;
  reportService: ReportService;
  userService: UserService;
  profileRepository: ProfileRepository;
  memberRepository: MemberRepository;
  branchRepository: BranchRepository;
  planRepository: PlanRepository;
  roleRepository: RoleRepository;
  memberListRepository: MemberListRepository;
  subscriptionRepository: SubscriptionRepository;
  auditLogRepository: AuditLogRepository;
  memberNumberingRepository: MemberNumberingRepository;
  memberNumberingService: MemberNumberingService;
}

const defaultServices: Services = {
  authService,
  memberService,
  subscriptionService,
  branchService,
  planService,
  roleService,
  reportService,
  userService,
  profileRepository,
  memberRepository,
  branchRepository,
  planRepository,
  roleRepository,
  memberListRepository,
  subscriptionRepository,
  auditLogRepository,
  memberNumberingRepository,
  memberNumberingService,
};

const ServicesContext = createContext<Services>(defaultServices);

export function ServicesProvider({ children }: { children: ReactNode }) {
  return <ServicesContext.Provider value={defaultServices}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  return useContext(ServicesContext);
}
