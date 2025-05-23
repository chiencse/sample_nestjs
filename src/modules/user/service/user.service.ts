import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { CreateUserDto } from '../dto/request/create-user.dto';
import { UserResponseDto } from '../dto/response/user-response.dto';
import { UserMapper } from '../mappers/user.mapper';
import { IResponse } from 'src/common/interfaces/response.interface';
import { ResponseUtil } from 'src/common/utils/response.util';
import * as bcrypt from 'bcrypt';
import { Logger } from '@nestjs/common';

@Injectable()
export class UserService {
    private readonly SALT_ROUNDS = 10;
    private readonly logger = new Logger(UserService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {}

    /**
     * Lấy thông tin của người dùng đang đăng nhập
     * @returns Response chứa thông tin người dùng
     */
    async getMyInfo(): Promise<IResponse<UserResponseDto>> {
        const request = (global as any).request;
        const userId = request?.user?.id;
        
        if (!userId) {
            throw new NotFoundException('Không tìm thấy thông tin người dùng');
        }

        this.logger.debug(`Getting my info for user ID: ${userId}`);
        const user = await this.findUserById(userId);
        return ResponseUtil.success(
            UserMapper.toResponseDto(user),
            'Lấy thông tin cá nhân thành công'
        );
    }

    /**
     * Tạo người dùng mới
     * @param createUserDto DTO chứa thông tin người dùng
     * @returns Response chứa thông tin người dùng đã tạo
     */
    async create(createUserDto: CreateUserDto): Promise<IResponse<UserResponseDto>> {
        // Trim username và password
        createUserDto.username = createUserDto.username.trim();
        createUserDto.password = createUserDto.password.trim();
        
        this.logger.debug(`Creating user with username: ${createUserDto.username}`);
        
        await this.validateUniqueConstraints(createUserDto);
        
        const hashedPassword = await this.hashPassword(createUserDto.password);
        
        const user = await UserMapper.toEntity({ ...createUserDto, password: hashedPassword });
        const savedUser = await this.userRepository.save(user);
        
        this.logger.debug(`User created successfully with ID: ${savedUser.id}`);
        return ResponseUtil.success(
            UserMapper.toResponseDto(savedUser),
            'Tạo người dùng thành công'
        );
    }

    /**
     * Lấy danh sách tất cả người dùng
     * @returns Response chứa danh sách người dùng
     */
    async findAll(): Promise<IResponse<UserResponseDto[]>> {
        const users = await this.userRepository.find();
        return ResponseUtil.success(
            UserMapper.toResponseDtoList(users),
            'Lấy danh sách người dùng thành công'
        );
    }

    /**
     * Tìm người dùng theo ID
     * @param id ID của người dùng
     * @returns Response chứa thông tin người dùng
     */
    async findOne(id: string): Promise<IResponse<UserResponseDto>> {
        const user = await this.findUserById(id);
        return ResponseUtil.success(
            UserMapper.toResponseDto(user),
            'Lấy thông tin người dùng thành công'
        );
    }

    /**
     * Tìm người dùng theo email
     * @param email Email của người dùng
     * @returns Người dùng hoặc null
     */
    async findByEmail(email: string): Promise<User | null> {
        return this.userRepository.findOne({ where: { email } });
    }

    /**
     * Tìm người dùng theo username
     * @param username Username của người dùng
     * @returns Người dùng hoặc null
     */
    async findByUsername(username: string): Promise<User | null> {
        return this.userRepository.findOne({ where: { username } });
    }

    /**
     * Cập nhật thông tin người dùng
     * @param id ID của người dùng
     * @param updateData Dữ liệu cập nhật
     * @returns Response chứa thông tin người dùng đã cập nhật
     */
    async update(id: string, updateData: Partial<CreateUserDto>): Promise<IResponse<UserResponseDto>> {
        const user = await this.findUserById(id);
        await this.validateUpdateConstraints(user, updateData);

        const updatedUser = await this.updateUserData(user, updateData);
        return ResponseUtil.success(
            UserMapper.toResponseDto(updatedUser),
            'Cập nhật thông tin người dùng thành công'
        );
    }

    /**
     * Xóa người dùng
     * @param id ID của người dùng
     * @returns Response xác nhận xóa thành công
     */
    async remove(id: string): Promise<IResponse<{ deleted: boolean }>> {
        const user = await this.findUserById(id);
        await this.userRepository.remove(user);
        
        return ResponseUtil.success(
            { deleted: true },
            'Xóa người dùng thành công'
        );
    }

    /**
     * Tìm người dùng theo ID và throw NotFoundException nếu không tìm thấy
     * @param id ID của người dùng
     * @returns Người dùng
     */
    private async findUserById(id: string): Promise<User> {
        const user = await this.userRepository.findOne({ where: { id } });
        if (!user) {
            throw new NotFoundException('Không tìm thấy người dùng');
        }
        return user;
    }

    /**
     * Kiểm tra các ràng buộc duy nhất khi tạo mới
     * @param createUserDto DTO chứa thông tin người dùng
     */
    private async validateUniqueConstraints(createUserDto: CreateUserDto): Promise<void> {
        const [existingEmail, existingUsername] = await Promise.all([
            this.findByEmail(createUserDto.email),
            this.findByUsername(createUserDto.username)
        ]);

        if (existingEmail) {
            throw new ConflictException('Email đã được sử dụng');
        }
        if (existingUsername) {
            throw new ConflictException('Tên đăng nhập đã được sử dụng');
        }
    }

    /**
     * Kiểm tra các ràng buộc duy nhất khi cập nhật
     * @param user Người dùng hiện tại
     * @param updateData Dữ liệu cập nhật
     */
    private async validateUpdateConstraints(user: User, updateData: Partial<CreateUserDto>): Promise<void> {
        if (updateData.email && updateData.email !== user.email) {
            const existingEmail = await this.findByEmail(updateData.email);
            if (existingEmail) {
                throw new ConflictException('Email đã được sử dụng');
            }
        }

        if (updateData.username && updateData.username !== user.username) {
            const existingUsername = await this.findByUsername(updateData.username);
            if (existingUsername) {
                throw new ConflictException('Tên đăng nhập đã được sử dụng');
            }
        }
    }

    /**
     * Cập nhật dữ liệu người dùng
     * @param user Người dùng hiện tại
     * @param updateData Dữ liệu cập nhật
     * @returns Người dùng đã cập nhật
     */
    private async updateUserData(user: User, updateData: Partial<CreateUserDto>): Promise<User> {
        if (updateData.password) {
            updateData.password = await this.hashPassword(updateData.password);
        }

        Object.assign(user, updateData);
        return this.userRepository.save(user);
    }

    /**
     * Hash mật khẩu
     * @param password Mật khẩu cần hash
     * @returns Mật khẩu đã hash
     */
    private async hashPassword(password: string): Promise<string> {
        this.logger.debug(`Hashing password with salt rounds: ${this.SALT_ROUNDS}`);
        const salt = await bcrypt.genSalt(this.SALT_ROUNDS);
        this.logger.debug(`Generated salt: ${salt}`);
        const hashedPassword = await bcrypt.hash(password, salt);
        this.logger.debug(`Generated hash: ${hashedPassword}`);
        return hashedPassword;
    }
}